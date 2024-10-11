<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

namespace OCA\Talk\Chat\Changelog;

use OCA\Talk\Events\BeforeRoomsFetchEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IConfig;

/**
 * @template-implements IEventListener<Event>
 */
class Listener implements IEventListener {
	public function __construct(
		protected Manager $manager,
		protected IConfig $serverConfig,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof BeforeRoomsFetchEvent) {
			return;
		}

		if ($this->serverConfig->getAppValue('spreed', 'changelog', 'yes') !== 'yes') {
			return;
		}

		// No need to add Update Log Channel
		// $this->manager->updateChangelog($event->getUserId());
	}
}
