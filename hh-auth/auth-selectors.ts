const hhAuthSelectors = {
  navigation: {
    resumesAndProfile: '[data-qa="profileAndResumes-button"]'
  },
  loginForm: {
    loginButton: '[data-qa="login"]',
    accountTypeCards: '[data-qa="account-type-cards"]',
    phone: '[data-qa="magritte-phone-input-calling-code"]',
    switchToPassword: '[data-qa="expand-login-by-password"]',
    password: '[data-qa="applicant-login-input-password"]',
    submit: '[data-qa="submit-button"]'
  },
  captcha: {
    container: '',
    challenge: ''
  },
  authState: {
    loggedInSignals: ['[data-qa="profileAndResumes-button"]'],
    loggedOutSignals: ['[data-qa="login"]']
  }
} as const

module.exports = {
  hhAuthSelectors
}
