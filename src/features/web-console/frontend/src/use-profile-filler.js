import { onUnmounted } from 'vue'
import { api } from './api'
import { createProfileFiller } from './profile-filler-controller.js'
import { createProfileWorkspace } from './profile-filler-workspace.js'

export function useProfileFiller() {
  const workspace = createProfileWorkspace(() => createProfileFiller(api))
  onUnmounted(workspace.dispose)
  return workspace
}
