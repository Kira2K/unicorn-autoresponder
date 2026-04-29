declare type Stack =
  | 'КИРА'
  | 'react'
  | 'fullstack'
  | 'java'
  | 'python'
  | 'golang'
  | 'c#'
  | 'da'
  | 'DEVOPS'
  | 'PM'
  | 'Vue'
  | 'AQA(Java)'
declare type Scenario = {
  market: 'Ru' | 'En' | 'Ru/En'
  stack: Stack
  url: string
}
declare type Scenarios = Scenario[]
