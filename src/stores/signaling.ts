/**
 * SPDX-FileCopyrightText: 2024 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { defineStore } from 'pinia'
import Vue from 'vue'

import type { Participant } from '../types'

type Session = {
	attendeeId: number | undefined,
	token: string,
	signalingSessionId: string,
	sessionId: string | undefined,
}
type State = {
	sessions: Record<string, Session>,
}
export const useSignalingStore = defineStore('signaling', {
	state: (): State => ({
		sessions: {},
	}),

	getters: {
		getSignalingSession: (state) => (signalingSessionId?: string): Session | undefined => {
			if (signalingSessionId) {
				return state.sessions[signalingSessionId]
			}
		},
	},

	actions: {
		addSignalingSession(session: Session) {
			Vue.set(this.sessions, session.signalingSessionId, session)
		},

		deleteSignalingSession(signalingSessionId: string) {
			if (this.sessions[signalingSessionId]) {
				Vue.delete(this.sessions, signalingSessionId)
			}
		},
	},
})
