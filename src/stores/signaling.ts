/**
 * SPDX-FileCopyrightText: 2024 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { defineStore } from 'pinia'
import Vue from 'vue'

import { ATTENDEE, PARTICIPANT } from '../constants.js'
import store from '../store/index.js'
import type { Participant } from '../types'

type Session = {
	attendeeId: number | undefined,
	token: string,
	signalingSessionId: string,
	sessionId: string | undefined,
}
type InternalSignalingPayload = {
	userId: string,
	sessionId: string,
	roomId: number,
	inCall: number,
	lastPing: number,
	participantPermissions: number,
}
type InternalUpdatePayload = Record<string, {
	inCall: number,
	lastPing: number,
	permissions: number,
	sessionIds: string[],
}>
type StandaloneSignalingJoinPayload = {
	userid: string,
	user: { displayname: string },
	sessionid: string, // Standalone signaling id
	roomsessionid: string, // Nextcloud id
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

		/**
		 * Update participants in store according to data from internal signaling server
		 *
		 * @param token the conversation token;
		 * @param participants the new participant objects;
		 * @return {boolean} whether list has unknown sessions mapped to attendees list
		 */
		updateParticipantsFromInternalSignaling(token: string, participants: InternalSignalingPayload[]): boolean {
			const attendeeUsers = store.getters.participantsList(token) as Participant[]
			const attendeeUsersToUpdate: InternalUpdatePayload = {}
			const newSessions = new Set<string>()
			let hasUnknownSessions = false

			for (const participant of participants) {
				// Look through existing sessions or find attendee by userId or guest sessionIds
				const attendeeId: number | undefined = this.getSignalingSession(participant.sessionId)?.attendeeId
					?? attendeeUsers.find(attendee => {
						return participant.userId
							? attendee.actorType !== ATTENDEE.ACTOR_TYPE.GUESTS && attendee.actorId === participant.userId
							: attendee.actorType === ATTENDEE.ACTOR_TYPE.GUESTS && attendee.sessionIds.includes(participant.sessionId)
					})?.attendeeId

				this.addSignalingSession({
					attendeeId,
					token,
					signalingSessionId: participant.sessionId,
					sessionId: participant.sessionId,
				})
				newSessions.add(participant.sessionId)
				if (!attendeeId) {
					hasUnknownSessions = true
					continue
				}

				if (!attendeeUsersToUpdate[attendeeId]) {
					// Prepare updated data
					attendeeUsersToUpdate[attendeeId] = {
						inCall: participant.inCall,
						lastPing: participant.lastPing,
						permissions: participant.participantPermissions,
						sessionIds: [participant.sessionId],
					}
				} else {
					// Participant might join from several devices
					attendeeUsersToUpdate[attendeeId].sessionIds.push(participant.sessionId)
				}
			}

			// Update participant objects
			for (const attendee of attendeeUsers) {
				const { attendeeId, sessionIds } = attendee
				if (attendeeUsersToUpdate[attendeeId]) {
					store.commit('updateParticipant', {
						token,
						attendeeId,
						updatedData: attendeeUsersToUpdate[attendeeId],
					})
				} else if (sessionIds.length) {
					// Participant left conversation from all devices
					store.commit('updateParticipant', {
						token,
						attendeeId,
						updatedData: { inCall: PARTICIPANT.CALL_FLAG.DISCONNECTED, sessionIds: [] },
					})
				}
			}

			// Clean up old sessions
			for (const session of Object.keys(this.sessions)) {
				if (!newSessions.has(session)) {
					this.deleteSignalingSession(session)
				}
			}

			return hasUnknownSessions
		},

		/**
		 * Update participants joined in store according to data from standalone signaling server
		 *
		 * @param token the conversation token;
		 * @param participants the newly joined participant objects;
		 * @return {boolean} whether list has unknown sessions mapped to attendees list
		 */
		updateParticipantsJoinedFromStandaloneSignaling(token: string, participants: StandaloneSignalingJoinPayload[]): boolean {
			const attendeeUsers = store.getters.participantsList(token) as Participant[]
			const attendeeUsersToUpdate: Record<string, { displayName?: string, sessionIds: string[] }> = {}
			let hasUnknownSessions = false

			for (const participant of participants) {
				const attendeeId = this.getSignalingSession(participant.sessionid)?.attendeeId
					?? attendeeUsers.find(attendee => {
						return participant.userid
							? attendee.actorType !== ATTENDEE.ACTOR_TYPE.GUESTS && attendee.actorId === participant.userid
							: attendee.actorType === ATTENDEE.ACTOR_TYPE.GUESTS && attendee.sessionIds.includes(participant.roomsessionid)
					})?.attendeeId

				this.addSignalingSession({
					attendeeId,
					token,
					signalingSessionId: participant.sessionid,
					sessionId: participant.roomsessionid,
				})

				if (!attendeeId) {
					hasUnknownSessions = true
					continue
				}

				const attendee = store.getters.getParticipant(token, attendeeId)

				if (!attendeeUsersToUpdate[attendeeId]) {
					attendeeUsersToUpdate[attendeeId] = { sessionIds: [...attendee.sessionIds] }
				}
				if (participant.user.displayname) {
					attendeeUsersToUpdate[attendeeId].displayName = participant.user.displayname
				}
				// Participant might join from several devices
				if (!attendeeUsersToUpdate[attendeeId].sessionIds.includes(participant.roomsessionid)) {
					attendeeUsersToUpdate[attendeeId].sessionIds.push(participant.roomsessionid)
				}
			}

			for (const [attendeeId, updatedData] of Object.entries(attendeeUsersToUpdate)) {
				store.commit('updateParticipant', {
					token,
					attendeeId: +attendeeId,
					updatedData,
				})
			}

			return hasUnknownSessions
		},

		/**
		 * Update participants left in store according to data from standalone signaling server
		 *
		 * @param signalingSessionIds disconnected signaling sessions;
		 */
		updateParticipantsLeftFromStandaloneSignaling(signalingSessionIds: string[]) {
			for (const signalingSessionId of signalingSessionIds) {
				const session = this.getSignalingSession(signalingSessionId)
				if (!session) {
					continue
				}
				this.deleteSignalingSession(signalingSessionId)

				const { token, attendeeId, sessionId } = session
				const attendee = store.getters.getParticipant(token, attendeeId)
				const updatedData : { sessionIds: [], inCall?: number } = {
					sessionIds: attendee.sessionIds.filter((id: string) => id !== sessionId)
				}
				if (updatedData.sessionIds.length === 0) {
					updatedData.inCall = PARTICIPANT.CALL_FLAG.DISCONNECTED
				}
				store.commit('updateParticipant', { token, attendeeId, updatedData })
			}
		},

	},
})
