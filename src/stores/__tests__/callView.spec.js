/**
 * SPDX-FileCopyrightText: 2021 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { setActivePinia, createPinia } from 'pinia'

import { CONVERSATION } from '../../constants.js'
import BrowserStorage from '../../services/BrowserStorage.js'
import vuexStore from '../../store/index.js'
import { useCallViewStore } from '../callView.js'

jest.mock('../../services/BrowserStorage.js', () => ({
	getItem: jest.fn().mockReturnValue(null),
	setItem: jest.fn(),
}))

describe('callViewStore', () => {
	const TOKEN = 'XXTOKENXX'
	const BROWSER_STORAGE_KEY = 'callprefs-XXTOKENXX-isgrid'
	let callViewStore

	beforeEach(() => {
		setActivePinia(createPinia())
		callViewStore = useCallViewStore()
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	describe('call view mode and presentation', () => {
		/**
		 * @param {number} type The type of the conversation
		 * @param {boolean} state Whether the grid is shown
		 * @param {string|null} browserStorageState Whether preference is set in BrowserStorage
		 */
		function testDefaultGridState(type, state, browserStorageState = null) {
			// Arrange
			BrowserStorage.getItem.mockReturnValueOnce(browserStorageState)
			// using commit instead of dispatch because the action also processes participants
			vuexStore.commit('addConversation', { token: TOKEN, type })

			// Act
			callViewStore.handleJoinCall({ token: TOKEN })

			// Assert
			expect(BrowserStorage.getItem).toHaveBeenCalledWith(BROWSER_STORAGE_KEY)
			expect(callViewStore.isGrid).toBe(state)
			expect(callViewStore.isStripeOpen).toBeTruthy()
		}

		it('restores grid state from BrowserStorage when joining call (true)', () => {
			// Arrange
			testDefaultGridState(CONVERSATION.TYPE.GROUP, true, 'true')
		})

		it('restores grid state from BrowserStorage when joining call (false)', () => {
			testDefaultGridState(CONVERSATION.TYPE.GROUP, false, 'false')
		})

		it('sets default grid state when joining call in group conversation', () => {
			testDefaultGridState(CONVERSATION.TYPE.GROUP, true)
		})

		it('sets default grid state when joining call in public conversation', () => {
			testDefaultGridState(CONVERSATION.TYPE.PUBLIC, true)
		})

		it('sets default grid state when joining call in one to one conversation', () => {
			testDefaultGridState(CONVERSATION.TYPE.ONE_TO_ONE, false)
		})

		it('switching call view mode saves in local storage', () => {
			vuexStore.dispatch('updateToken', TOKEN)

			callViewStore.setCallViewMode({
				isGrid: true,
				isStripeOpen: false,
			})
			expect(callViewStore.isGrid).toBeTruthy()
			expect(callViewStore.isStripeOpen).toBeFalsy()
			expect(BrowserStorage.setItem).toHaveBeenCalledWith(BROWSER_STORAGE_KEY, true)

			callViewStore.setCallViewMode({
				isGrid: false,
				isStripeOpen: true,
			})
			expect(callViewStore.isGrid).toBeFalsy()
			expect(callViewStore.isStripeOpen).toBeTruthy()
			expect(BrowserStorage.setItem).toHaveBeenCalledWith(BROWSER_STORAGE_KEY, false)
		})

		it('start presentation switches off grid view and restores when it ends', () => {
			[{
				isGrid: true,
				isStripeOpen: true,
			}, {
				isGrid: false,
				isStripeOpen: false,
			}].forEach((testState) => {
				callViewStore.setCallViewMode(testState)

				callViewStore.startPresentation()
				expect(callViewStore.isGrid).toBeFalsy()
				expect(callViewStore.isStripeOpen).toBeFalsy()

				callViewStore.stopPresentation()
				expect(callViewStore.isGrid).toEqual(testState.isGrid)
				expect(callViewStore.isStripeOpen).toEqual(testState.isStripeOpen)
			})
		})

		it('switching modes during presentation does not resets it after it ends', () => {
			callViewStore.setCallViewMode({
				isGrid: true,
				isStripeOpen: true,
			})
			callViewStore.startPresentation()

			// switch during presentation
			callViewStore.setCallViewMode({
				isGrid: true,
				isStripeOpen: true,
			})
			callViewStore.stopPresentation()

			// state kept, not restored
			expect(callViewStore.isGrid).toBeTruthy()
			expect(callViewStore.isStripeOpen).toBeTruthy()
		})

		it('starting presentation twice does not mess up remembered state', () => {
			callViewStore.setCallViewMode({
				isGrid: true,
				isStripeOpen: true,
			})
			expect(callViewStore.presentationStarted).toBeFalsy()

			callViewStore.startPresentation()
			expect(callViewStore.presentationStarted).toBeTruthy()

			// switch during presentation
			callViewStore.setCallViewMode({
				isGrid: true,
				isStripeOpen: true,
			})
			callViewStore.startPresentation()
			// state kept
			expect(callViewStore.presentationStarted).toBeTruthy()
			expect(callViewStore.isGrid).toBeTruthy()
			expect(callViewStore.isStripeOpen).toBeTruthy()

			callViewStore.stopPresentation()
			expect(callViewStore.presentationStarted).toBeFalsy()
			// state kept, not restored
			expect(callViewStore.isGrid).toBeTruthy()
			expect(callViewStore.isStripeOpen).toBeTruthy()
		})

		it('stopping presentation twice does not mess up remembered state', () => {
			callViewStore.setCallViewMode({
				isGrid: true,
				isStripeOpen: true,
			})
			expect(callViewStore.presentationStarted).toBeFalsy()

			callViewStore.startPresentation()
			expect(callViewStore.presentationStarted).toBeTruthy()

			callViewStore.stopPresentation()
			expect(callViewStore.presentationStarted).toBeFalsy()
			expect(callViewStore.isGrid).toBeTruthy()
			expect(callViewStore.isStripeOpen).toBeTruthy()

			callViewStore.setCallViewMode({
				isGrid: false,
				isStripeOpen: false,
			})
			callViewStore.stopPresentation()
			expect(callViewStore.presentationStarted).toBeFalsy()
			// state kept, not reset
			expect(callViewStore.isGrid).toBeFalsy()
			expect(callViewStore.isStripeOpen).toBeFalsy()
		})
	})
})
