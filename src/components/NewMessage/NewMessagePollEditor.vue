<!--
  - SPDX-FileCopyrightText: 2022 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<NcDialog :name="t('spreed', 'Create new poll')"
		:close-on-click-outside="!isFilled"
		v-on="$listeners"
		@update:open="dismissEditor">
		<!-- Poll Question -->
		<p class="poll-editor__caption">
			{{ t('spreed', 'Question') }}
		</p>
		<NcTextField :value.sync="pollForm.question" :label="t('spreed', 'Ask a question')" v-on="$listeners" />
		<!--native file picker, hidden -->
		<input id="poll-upload"
			ref="pollImport"
			type="file"
			class="hidden-visually"
			@change="importPoll">
		<NcButton class="poll-editor__button"
			type="secondary"
			wide
			@click="triggerImport">
			{{ t('spreed', 'Import poll from file') }}
		</NcButton>

		<!-- Poll options -->
		<p class="poll-editor__caption">
			{{ t('spreed', 'Answers') }}
		</p>
		<div v-for="(option, index) in pollForm.options"
			:key="index"
			class="poll-editor__option">
			<NcTextField ref="pollOption"
				:value.sync="pollForm.options[index]"
				:label="t('spreed', 'Answer {option}', {option: index + 1})" />
			<NcButton v-if="pollForm.options.length > 2"
				type="tertiary"
				:aria-label="t('spreed', 'Delete poll option')"
				@click="deleteOption(index)">
				<template #icon>
					<Close :size="20" />
				</template>
			</NcButton>
		</div>

		<!-- Add options -->
		<NcButton class="poll-editor__add-more" type="tertiary" @click="addOption">
			<template #icon>
				<Plus />
			</template>
			{{ t('spreed', 'Add answer') }}
		</NcButton>

		<!-- Poll settings -->
		<p class="poll-editor__caption">
			{{ t('spreed', 'Settings') }}
		</p>
		<div class="poll-editor__settings">
			<NcCheckboxRadioSwitch :checked.sync="pollForm.isPrivate" type="checkbox">
				{{ t('spreed', 'Private poll') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch :checked.sync="pollForm.isMultipleAnswer" type="checkbox">
				{{ t('spreed', 'Multiple answers') }}
			</NcCheckboxRadioSwitch>
		</div>
		<template #actions>
			<NcButton type="tertiary" @click="dismissEditor">
				{{ t('spreed', 'Dismiss') }}
			</NcButton>
			<NcButton v-if="isFilled"
				type="secondary"
				:href="exportPollBlob"
				:download="exportPollFileName">
				{{ t('spreed', 'Export') }}
			</NcButton>
			<NcButton type="primary" :disabled="!isFilled" @click="createPoll">
				{{ t('spreed', 'Create poll') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script>
import { computed, reactive } from 'vue'

import Close from 'vue-material-design-icons/Close.vue'
import Plus from 'vue-material-design-icons/Plus.vue'

import { t } from '@nextcloud/l10n'

import NcButton from '@nextcloud/vue/dist/Components/NcButton.js'
import NcCheckboxRadioSwitch from '@nextcloud/vue/dist/Components/NcCheckboxRadioSwitch.js'
import NcDialog from '@nextcloud/vue/dist/Components/NcDialog.js'
import NcTextField from '@nextcloud/vue/dist/Components/NcTextField.js'

import { usePollsStore } from '../../stores/polls.ts'

export default {
	name: 'NewMessagePollEditor',

	components: {
		NcCheckboxRadioSwitch,
		NcButton,
		NcDialog,
		NcTextField,
		// Icons
		Close,
		Plus,
	},

	props: {
		token: {
			type: String,
			required: true,
		},
	},

	emits: ['close'],

	setup() {
		const pollForm = reactive({
			question: '',
			options: ['', ''],
			isPrivate: false,
			isMultipleAnswer: false,
		})
		const isFilled = computed(() => !!pollForm.question || pollForm.options.some(option => option))

		const exportPollBlob = computed(() => {
			if (!isFilled.value) {
				return null
			}
			const jsonString = JSON.stringify(pollForm, null, 2)
			const blob = new Blob([jsonString], { type: 'application/json' })

			return URL.createObjectURL(blob)
		})
		const exportPollFileName = `Talk Poll ${new Date().toISOString().slice(0, 10)}`

		return {
			pollsStore: usePollsStore(),
			pollForm,
			isFilled,
			exportPollBlob,
			exportPollFileName,
		}
	},

	methods: {
		t,

		deleteOption(index) {
			this.pollForm.options.splice(index, 1)
		},

		dismissEditor() {
			this.$emit('close')
		},

		addOption() {
			this.pollForm.options.push('')
			this.$nextTick(() => {
				this.$refs.pollOption.at(-1).focus()
			})
		},

		async createPoll() {
			const poll = await this.pollsStore.createPoll({
				token: this.token,
				question: this.pollForm.question,
				options: this.pollForm.options,
				resultMode: this.pollForm.isPrivate ? 1 : 0,
				maxVotes: this.pollForm.isMultipleAnswer ? 0 : 1
			})
			if (poll) {
				this.dismissEditor()
			}
		},

		triggerImport() {
			this.$refs.pollImport.click()
		},

		importPoll(event) {
			if (!event?.target?.files?.[0]) {
				return
			}

			const reader = new FileReader()
			reader.onload = (e) => {
				try {
					const jsonObject = JSON.parse(e.target.result)
					for (const key of Object.keys(this.pollForm)) {
						if (jsonObject[key] !== undefined) {
							this.pollForm[key] = jsonObject[key]
						}
					}
				} catch (error) {
					console.error('Error while parsing JSON:', error)
				}
			}

			reader.readAsText(event.target.files[0])
		},
	},
}
</script>

<style lang="scss" scoped>

.poll-editor {
	&__caption {
		margin: calc(var(--default-grid-baseline) * 2) 0 var(--default-grid-baseline);
		font-weight: bold;
		color: var(--color-primary-element);
	}

	&__button {
		margin-block: 8px;
	}

	&__option {
		display: flex;
		align-items: flex-end;
		gap: var(--default-grid-baseline);
		width: 100%;
		margin-bottom: calc(var(--default-grid-baseline) * 2);
	}

	&__settings {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 8px;
	}
}
</style>
