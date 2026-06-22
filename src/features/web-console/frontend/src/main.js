import { createApp } from 'vue'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import Accordion from 'primevue/accordion'
import AccordionContent from 'primevue/accordioncontent'
import AccordionHeader from 'primevue/accordionheader'
import AccordionPanel from 'primevue/accordionpanel'
import Button from 'primevue/button'
import Card from 'primevue/card'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Password from 'primevue/password'
import ProgressSpinner from 'primevue/progressspinner'
import Tag from 'primevue/tag'
import Toolbar from 'primevue/toolbar'
import 'primeicons/primeicons.css'
import './styles.css'
import App from './App.vue'

createApp(App)
  .use(PrimeVue, {
    theme: {
      preset: Aura,
      options: {
        darkModeSelector: false
      }
    }
  })
  .component('Accordion', Accordion)
  .component('AccordionContent', AccordionContent)
  .component('AccordionHeader', AccordionHeader)
  .component('AccordionPanel', AccordionPanel)
  .component('Button', Button)
  .component('Card', Card)
  .component('Column', Column)
  .component('DataTable', DataTable)
  .component('Dialog', Dialog)
  .component('InputText', InputText)
  .component('Message', Message)
  .component('Password', Password)
  .component('ProgressSpinner', ProgressSpinner)
  .component('Tag', Tag)
  .component('Toolbar', Toolbar)
  .mount('#app')
