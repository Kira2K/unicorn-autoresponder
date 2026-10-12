/** Declared reference cases for a future approved live comparison; mocks cannot establish model accuracy. */
export const classificationQualityCases = [
  {id:'go-required',title:'Senior Golang Engineer',location:'Europe',description:'Build backend transaction services in Go. Production Golang experience is required.',expected:'eligible',stack:'7'},
  {id:'go-secondary',title:'Senior Software Engineer',location:'Yerevan, AM',description:'Strong PHP is required. Work across PHP APIs and Angular UI. Pick up Go as needed.',expected:'excluded',stack:'7'},
  {id:'django-heavy',title:'Senior Python Developer',location:'Worldwide',description:'Own our Django monolith. Most work is Django models, Django admin and Django REST Framework APIs.',expected:'excluded',stack:'2'},
  {id:'django-optional',title:'Python Backend Engineer',location:'Europe',description:'Develop Python backend APIs with FastAPI. Django experience is optional, a nice-to-have.',expected:'eligible',stack:'2'},
  {id:'developer-tests',title:'Middle Java Developer',location:'London, GB',description:'Build Spring Boot microservices in Java. Write unit and integration tests for your own services.',expected:'eligible',stack:'5'},
  {id:'test-employment',title:'Senior Java QA Automation Engineer',location:'Worldwide',description:'Your role is test automation, maintaining Selenium suites and validating releases.',expected:'excluded',stack:'5'},
  {id:'mandatory-us',title:'Senior Golang Engineer',location:'Remote',description:'Develop production Golang backend services. Candidates must reside in the United States.',expected:'excluded',stack:'7'},
  {id:'hq-is-not-residence',title:'Senior Java Developer',location:'Worldwide',description:'Build Java backend APIs. We are headquartered in the United States; employees can work remotely worldwide.',expected:'eligible',stack:'5'},
  {id:'staff-ceiling',title:'Staff Python Engineer',location:'Worldwide',description:'Build Python backend services. This is a Staff-level position above Senior.',expected:'excluded',stack:'2'},
  {id:'salary-below',title:'Senior Java Developer',location:'Europe',description:'Build Java backend services. Salary: USD 24,000 gross per year.',expected:'excluded',stack:'5'},
  {id:'salary-range',title:'Senior Java Developer',location:'Europe',description:'Build Java backend services. Salary: USD 2,500–4,000 gross per month.',expected:'eligible',stack:'5'},
  {id:'publication-boundary',title:'Senior Python Engineer',location:'Worldwide',description:'Develop production Python backend services, APIs and PostgreSQL integrations.',publishedAt:'2026-09-15T12:00:00Z',asOf:'2026-09-30T00:00:00Z',expected:'eligible',stack:'2'},
] as const
