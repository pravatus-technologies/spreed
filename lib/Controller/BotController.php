<?php

declare(strict_types=1);

/**
 * @copyright Copyright (c) 2023, Joas Schilling <coding@schilljs.com>
 *
 * @author Joas Schilling <coding@schilljs.com>
 *
 * @license GNU AGPL version 3 or any later version
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

namespace OCA\Talk\Controller;

use OCA\Talk\Chat\ChatManager;
use OCA\Talk\Exceptions\UnauthorizedException;
use OCA\Talk\Manager;
use OCA\Talk\Middleware\Attribute\RequireLoggedInModeratorParticipant;
use OCA\Talk\Model\Attendee;
use OCA\Talk\Model\Bot;
use OCA\Talk\Model\BotConversation;
use OCA\Talk\Model\BotConversationMapper;
use OCA\Talk\Model\BotServerMapper;
use OCA\Talk\Service\BotService;
use OCA\Talk\Service\ChecksumVerificationService;
use OCA\Talk\Service\ParticipantService;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\BruteForceProtection;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Comments\MessageTooLongException;
use OCP\Comments\NotFoundException;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

class BotController extends AEnvironmentAwareController {
	public function __construct(
		string $appName,
		IRequest $request,
		protected ChatManager $chatManager,
		protected ParticipantService $participantService,
		protected ITimeFactory $timeFactory,
		protected ChecksumVerificationService $checksumVerificationService,
		protected BotConversationMapper $botConversationMapper,
		protected BotServerMapper $botServerMapper,
		protected BotService $botService,
		protected Manager $manager,
		protected LoggerInterface $logger,
	) {
		parent::__construct($appName, $request);
	}

	/**
	 * Sends a new chat message to the given room.
	 *
	 * The author and timestamp are automatically set to the current user/guest
	 * and time.
	 *
	 * @param string $token conversation token
	 * @param string $message the message to send
	 * @param string $referenceId for the message to be able to later identify it again
	 * @param int $replyTo Parent id which this message is a reply to
	 * @param bool $silent If sent silent the chat message will not create any notifications
	 * @return DataResponse the status code is "201 Created" if successful, and
	 *         "404 Not found" if the room or session for a guest user was not
	 *         found".
	 */
	#[BruteForceProtection(action: 'bot')]
	#[PublicPage]
	public function sendMessage(string $token, string $message, string $referenceId = '', int $replyTo = 0, bool $silent = false): DataResponse {
		$random = $this->request->getHeader('X-Nextcloud-Talk-Bot-Random');
		if (empty($random) || strlen($random) < 32) {
			$this->logger->error('Invalid Random received from bot response');
			return new DataResponse([], Http::STATUS_BAD_REQUEST);
		}
		$checksum = $this->request->getHeader('X-Nextcloud-Talk-Bot-Signature');
		if (empty($checksum)) {
			$this->logger->error('Invalid Signature received from bot response');
			return new DataResponse([], Http::STATUS_BAD_REQUEST);
		}

		$bots = $this->botService->getBotsForToken($token);
		$bot = null;
		foreach ($bots as $botAttempt) {
			try {
				$this->checksumVerificationService->validateRequest(
					$random,
					$checksum,
					$botAttempt->getBotServer()->getSecret(),
					$message
				);
				$bot = $botAttempt;
				break;
			} catch (UnauthorizedException) {
			}
		}

		if (!$bot instanceof Bot) {
			$this->logger->debug('No valid Bot entry found');
			$response = new DataResponse([], Http::STATUS_UNAUTHORIZED);
			$response->throttle(['action' => 'bot']);
			return $response;
		}

		$room = $this->manager->getRoomByToken($token);

		$actorType = Attendee::ACTOR_BOTS;
		$actorId = Attendee::ACTOR_BOT_PREFIX . $bot->getBotServer()->getUrlHash();

		$parent = null;
		if ($replyTo !== 0) {
			try {
				$parent = $this->chatManager->getParentComment($room, (string) $replyTo);
			} catch (NotFoundException $e) {
				// Someone is trying to reply cross-rooms or to a non-existing message
				return new DataResponse([], Http::STATUS_BAD_REQUEST);
			}
		}

		$this->participantService->ensureOneToOneRoomIsFilled($room);
		$creationDateTime = $this->timeFactory->getDateTime('now', new \DateTimeZone('UTC'));

		try {
			$this->chatManager->sendMessage($room, $this->participant, $actorType, $actorId, $message, $creationDateTime, $parent, $referenceId, $silent);
		} catch (MessageTooLongException) {
			return new DataResponse([], Http::STATUS_REQUEST_ENTITY_TOO_LARGE);
		} catch (\Exception) {
			return new DataResponse([], Http::STATUS_BAD_REQUEST);
		}

		return new DataResponse([], Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	#[RequireLoggedInModeratorParticipant]
	public function listBots(): DataResponse {
		$alreadyInstalled = array_map(static function (BotConversation $bot): int {
			return $bot->getBotId();
		}, $this->botConversationMapper->findForToken($this->room->getToken()));

		$bots = $this->botServerMapper->getAllBots();
		foreach ($bots as $bot) {
			$state = in_array($bot->getId(), $alreadyInstalled, true) ? Bot::STATE_ENABLED : Bot::STATE_DISABLED;

			if ($bot->getState() === Bot::STATE_NO_SETUP) {
				if ($state === Bot::STATE_DISABLED) {
					continue;
				}
				$state = Bot::STATE_NO_SETUP;
			}

			$data[] = [
				'id' => $bot->getId(),
				'name' => $bot->getName(),
				'description' => $bot->getDescription(),
				'state' => $state ,
			];
		}

		return new DataResponse($data);
	}

	#[NoAdminRequired]
	#[RequireLoggedInModeratorParticipant]
	public function enableBot(int $botId): DataResponse {
		try {
			$bot = $this->botServerMapper->findById($botId);
		} catch (DoesNotExistException) {
			return new DataResponse([
				'error' => 'bot',
			], Http::STATUS_BAD_REQUEST);
		}

		if ($bot->getState() !== Bot::STATE_ENABLED) {
			return new DataResponse([
				'error' => 'bot',
			], Http::STATUS_BAD_REQUEST);
		}

		$alreadyInstalled = array_map(static function (BotConversation $bot): int {
			return $bot->getBotId();
		}, $this->botConversationMapper->findForToken($this->room->getToken()));

		if (in_array($botId, $alreadyInstalled)) {
			return new DataResponse([], Http::STATUS_OK);
		}

		$conversationBot = new BotConversation();
		$conversationBot->setBotId($botId);
		$conversationBot->setToken($this->room->getToken());
		$conversationBot->setState(Bot::STATE_ENABLED);

		$this->botConversationMapper->insert($conversationBot);
		return new DataResponse([], Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	#[RequireLoggedInModeratorParticipant]
	public function disableBot(int $botId): DataResponse {
		try {
			$bot = $this->botServerMapper->findById($botId);
		} catch (DoesNotExistException) {
			return new DataResponse([
				'error' => 'bot',
			], Http::STATUS_BAD_REQUEST);
		}

		if ($bot->getState() !== Bot::STATE_ENABLED) {
			return new DataResponse([
				'error' => 'bot',
			], Http::STATUS_BAD_REQUEST);
		}

		$this->botConversationMapper->deleteByBotIdAndTokens($botId, [$this->room->getToken()]);
		return new DataResponse([], Http::STATUS_OK);
	}
}
