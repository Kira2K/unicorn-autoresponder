type ClientRefOverride = {
  from: string
  to: string
  reason: string
}

const CLIENT_REF_OVERRIDES: ClientRefOverride[] = [
  {
    from: 'client_e_алексей',
    to: 'client_e_алексей_сериков',
    reason: 'User-confirmed: Алексей is Алексей Сериков.'
  },
  {
    from: 'client_j_дима_балакин',
    to: 'client_j_дмитрий_балакин',
    reason: 'User-confirmed alias from Google Sheet.'
  },
  {
    from: 'client_l_владимир',
    to: 'client_l_владимир_маскаев',
    reason: 'User-confirmed stabilized client identity.'
  },
  {
    from: 'client_p_иван_к',
    to: 'client_p_иван_карпенко',
    reason: 'User-confirmed stabilized client identity.'
  },
  {
    from: 'client_r_лев',
    to: 'client_r_лев_какалашвили',
    reason: 'User-confirmed stabilized client identity.'
  },
  {
    from: 'client_w_борис_мугинов',
    to: 'client_w_бари_мугинов',
    reason: 'User-confirmed stabilized client identity.'
  },
  {
    from: 'client_x_тёма_белкин',
    to: 'client_x_артемий_белкин',
    reason: 'User-confirmed alias from Google Sheet.'
  },
  {
    from: 'client_y_тая_аль',
    to: 'client_y_таисия_аль',
    reason: 'User-confirmed alias from Google Sheet.'
  },
  {
    from: 'client_aa_всеволод',
    to: 'client_aa_всеволод_насонов',
    reason: 'User-confirmed alias from Google Sheet.'
  },
  {
    from: 'client_ac_вова_vue',
    to: 'client_ac_владимир_рыбалкин',
    reason: 'User-confirmed: Вова Vue is Владимир Рыбалкин.'
  },
  {
    from: 'client_ag_денис',
    to: 'client_ag_денис_полочкин',
    reason: 'User-confirmed: @dpgod / React-Frontend is Денис Полочкин.'
  },
  {
    from: 'client_ai_дан',
    to: 'client_ai_дан_цой',
    reason: 'User-confirmed: Дан Цой is Dan Tsoy.'
  },
  {
    from: 'client_aj_айжан',
    to: 'client_aj_айжан_мойнокова',
    reason: 'User-confirmed alias from Google Sheet.'
  },
  {
    from: 'client_al_кирилл_уст',
    to: 'client_al_кирилл_устинов',
    reason: 'User-confirmed alias from Google Sheet.'
  },
  {
    from: 'client_ar_саша_тимонин',
    to: 'client_ar_александр_тимонин',
    reason: 'User-confirmed alias from Google Sheet.'
  },
  {
    from: 'client_ax_илья',
    to: 'client_ax_илья_донец',
    reason: 'User-confirmed stabilized client identity.'
  },
  {
    from: 'client_az_никита',
    to: 'client_az_никита_шаталов',
    reason: 'User-confirmed: Никита is Никита Шаталов.'
  },
  {
    from: 'client_bb_данияр',
    to: 'client_bb_данияр_сейфолла',
    reason: 'User-confirmed stabilized client identity.'
  },
  {
    from: 'client_bo_владимир_2',
    to: 'client_bo_владимир_будыльников',
    reason: 'User-confirmed stabilized client identity.'
  },
  {
    from: 'client_bx_антон',
    to: 'client_bx_антон_подольский',
    reason: 'User-confirmed: the non-Панфилов Антон is Антон Подольский.'
  }
]

const MENTOR_CLIENT_REF_OVERRIDES: Record<string, string> = {
  'алексей|сериков алексей валерьевич': 'client_e_алексей_сериков',
  'дан|цой дан александрович': 'client_ai_дан_цой',
  'вова vue|рыбалкин владимир александрович': 'client_ac_владимир_рыбалкин',
  'никита|шаталов никита константинович': 'client_az_никита_шаталов',
  'андрей кочеткова|кочетков андрей андреевич': 'client_bs_андрей'
}

function normalizeClientRef(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е')
}

function getCanonicalClientRef(value: unknown): string {
  const normalized = normalizeClientRef(value)
  const override = CLIENT_REF_OVERRIDES.find(item => normalizeClientRef(item.from) === normalized)
  return override?.to ?? String(value ?? '').trim()
}

function getClientRefOverride(value: unknown): ClientRefOverride | undefined {
  const normalized = normalizeClientRef(value)
  return CLIENT_REF_OVERRIDES.find(item => normalizeClientRef(item.from) === normalized)
}

module.exports = {
  CLIENT_REF_OVERRIDES,
  MENTOR_CLIENT_REF_OVERRIDES,
  getCanonicalClientRef,
  getClientRefOverride,
  normalizeClientRef
}
