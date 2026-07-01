const hhAuthSelectors = {
  navigation: {
    resumesAndProfile:
      '[data-qa="profileAndResumes-button"], [data-qa="mainmenu_profileAndResumes"], [href*="/applicant/resumes"]'
  },
  loginForm: {
    loginButton:
      '[data-qa="login"], [href*="/account/login"], [data-qa="mainmenu_login"]',
    accountTypeCards: '[data-qa="account-type-cards"]',
    phone: '[data-qa="magritte-phone-input-calling-code"]',
    emailCredentialType:
      '[data-qa="credential-type-EMAIL"], input[value="EMAIL"], input[value="email"]',
    email:
      '[data-qa="applicant-login-input-email"], input[type="email"], input[name="login"], input[name="username"]',
    switchToPassword: '[data-qa="expand-login-by-password"]',
    password:
      '[data-qa="applicant-login-input-password"], input[type="password"]',
    submit: '[data-qa="submit-button"], button[type="submit"], input[type="submit"]'
  },
  captcha: {
    container: '',
    challenge: ''
  },
  authState: {
    loggedInSignals: [
      '[data-qa="profileAndResumes-button"]',
      '[data-qa="vacancyResponses-button"]',
      '[data-qa="mainmenu_profileAndResumes"]',
      '[data-qa="mainmenu_vacancyResponses"]',
      '[href*="/applicant/resumes"]',
      '[href*="/applicant/negotiations"]'
    ],
    loggedOutSignals: [
      '[data-qa="login"]',
      '[data-qa="mainmenu_login"]',
      '[href*="/account/login"]'
    ]
  }
} as const

module.exports = {
  hhAuthSelectors
}
