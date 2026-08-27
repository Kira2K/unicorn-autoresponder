<script setup>
import { downloadProfileFile, fileSize } from './profile-file'
import ProfileDraftEditor from './ProfileDraftEditor.vue'
import ProfileIssues from './ProfileIssues.vue'
defineProps({ filler: { type: Object, required: true } })
</script>

<template>
  <div class="profile-filler-input">
    <Button label="Generate from final EN CV on Drive" icon="pi pi-sparkles"
      data-testid="profile-filler-generate" @click="filler.generate()" />
    <label class="profile-file-drop" for="profile-cv-file" @dragover.prevent
      @drop="filler.dropGenerationFile" data-testid="profile-filler-cv-drop">
      <i class="pi pi-file-import" /><strong>Upload final EN CV</strong>
      <span>Drop or choose PDF/DOCX · maximum 20 MB · generation starts immediately</span>
      <input id="profile-cv-file" type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        data-testid="profile-filler-cv-file" @change="filler.chooseGenerationFile" />
    </label>
    <div class="profile-filler-divider"><span>or upload prepared JSON</span></div>
    <label class="profile-file-drop" for="profile-file" @dragover.prevent @drop="filler.dropFile"
      data-testid="profile-filler-drop">
      <i class="pi pi-upload" /><strong>Drop profile.json here</strong>
      <span>or click to choose a JSON file · maximum 250 KB</span>
      <input id="profile-file" type="file" accept=".json,application/json"
        data-testid="profile-filler-file" @change="filler.chooseFile" />
    </label>
    <div v-if="filler.selectedFile.value" class="profile-file-selected">
      <i class="pi pi-file" /><strong>{{ filler.selectedFile.value.name }}</strong>
      <span>{{ fileSize(filler.selectedFile.value.size) }}</span>
    </div>
    <ProfileDraftEditor v-if="filler.draft.value" :model-value="filler.draft.value"
      @update:model-value="filler.updateDraft" />
    <ProfileIssues :issues="filler.issues.value" />
    <Button v-if="filler.draft.value" label="Download normalized JSON" severity="secondary" outlined
      @click="downloadProfileFile(filler.draft.value)" />
    <Button label="Build LinkedIn preview" :disabled="!filler.draft.value"
      data-testid="profile-filler-preview" @click="filler.preview" />
  </div>
</template>
