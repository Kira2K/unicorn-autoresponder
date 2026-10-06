<script>
import { h } from 'vue'

export default {
  props: { preview: Boolean },
  setup(props, { slots }) {
    return () => h('div', { class: 'dashboard-grid' },
      (props.preview ? ['profile', 'workplaces', 'accounts', 'telegram', 'actions'] : ['profile', 'telegram', 'actions', 'accounts'])
        .flatMap(name => slots[name]?.() ?? []))
  }
}
</script>
