/** Noco metadata only. No SQL, network, credentials or automatic apply. */
export type NocoColumn = Record<string, unknown> & {
  id: string; column_name: string; title: string; uidt: string; dt: string;
};

export const linkLabDisplayFields = [
  { table: 'linklab', name: 'status', title: 'Статус LinkedIn',
    options: ['Новый', 'Прогрев', 'Раскачка', 'Пауза', 'Блок', 'Завершен'] },
  { table: 'linklab', name: 'proxy_state', title: 'Смена прокси',
    options: ['Не активна', 'Активна'] },
  { table: 'clients', name: 'client_role', title: 'client_role',
    options: ['клиент', 'ученик', 'реферал', 'фейк'] },
  { table: 'linklab', name: 'new_account_url', title: 'Ссылка на новый аккаунт', options: null },
] as const;
type DisplayField = typeof linkLabDisplayFields[number];

/** Formula formatting is nested; top-level date_format is ignored by Noco. */
export function linkLabDateDisplay(dateOnly = false) {
  return { display_type: dateOnly ? 'Date' : 'DateTime', display_column_meta: {
    meta: { date_format: 'DD.MM.YYYY', ...(dateOnly ? {} : {
      time_format: 'HH:mm', is12hrFormat: false, useSameTimezoneForAll: true,
      timezone: 'Europe/Moscow', isDisplayTimezone: true,
    }) }, custom: {},
  } };
}

/** Read-only display of SQL results. These formulas never write source fields. */
export const linkLabIntakeDisplayFields = [
  { title: 'Дата финализированного CV', uidt: 'Formula', formula_raw: '{en_approved_at}',
    meta: linkLabDateDisplay() },
  { title: 'Данные аккаунта', uidt: 'Formula',
    formula_raw: "IF({credentials_issue} == 'linkedin_credentials_incomplete', 'Не заполнен логин или пароль', IF({credentials_issue} == 'linkedin_account_missing', 'Аккаунт удалён', {credentials_issue}))" },
] as const;

export const linkLabResultDisplayFields = [
  { title: 'Заполнение профиля', uidt: 'Formula',
    formula_raw: "IF({profile_percent} == BLANK(), '', CONCAT({profile_percent}, '%'))" },
  ...([
    ['blocked_at', 'Дата блока'], ['new_account_due_date', 'Создание нового аккаунта'],
    ['profile_first_completed_at', 'Дата заполнения'], ['proxy_ends_at', 'Активность запрещена до'],
  ] as const).map(([name, title]) => ({ title, uidt: 'Formula', formula_raw: `{${name}}`,
    meta: linkLabDateDisplay(name === 'new_account_due_date') })),
] as const;

/** A missing CRM binding must not render a button leading back to Noco. */
export function linkLabCrmDisplayField(crmBaseUrl: string) {
  const url = new URL(crmBaseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    url.search || url.hash || url.pathname !== '/') throw new Error('linklab_crm_url_invalid');
  return { title: 'Карточка CRM', uidt: 'Formula',
    formula_raw: `IF({crm_student_id} == BLANK(), '', CONCAT('${url.origin}/manager/students/', {crm_student_id}, '/'))`,
    meta: { display_type: 'URL', display_column_meta: { meta: {}, custom: {} } },
  };
}

export const linkLabColumnOrder = [
  'Ученик', 'client_role', 'Стек', 'LinkedIn', 'status', 'Дата финализированного CV',
  'Заполнение профиля', 'Дата заполнения', 'Дата блока', 'Создание нового аккаунта',
  'new_account_url', 'proxy_state', 'Карточка CRM', 'Обмен с CRM', 'Ошибка обмена',
  'Проблема аккаунта', 'Данные аккаунта', 'Активность запрещена до',
] as const;

/** A missing physical property must not become a new default in Noco's PATCH. */
export function planNocoDisplay(column: NocoColumn, field: DisplayField): NocoColumn | null {
  if (column.column_name !== field.name || column.dt !== 'text') {
    throw new Error('linklab_display_column_mismatch');
  }
  for (const key of ['rqd', 'cdf', 'pk', 'ai', 'un', 'dtx', 'dtxp', 'dtxs']) {
    if (!Object.hasOwn(column, key) || column[key] === undefined) {
      throw new Error(`linklab_display_metadata_incomplete:${key}`);
    }
  }
  if (field.options && column.uidt === 'SingleSelect') {
    const options = (column.colOptions as { options?: Array<{ title: string }> } | null)?.options;
    if (column.title === field.title && JSON.stringify(options?.map(o => o.title)) === JSON.stringify(field.options)) {
      return null;
    }
    // Updating existing options may rewrite records. Never do that as formatting.
    throw new Error('linklab_display_existing_select_differs');
  }
  if (column.uidt !== 'LongText') throw new Error('linklab_display_type_not_supported');
  if (!field.options && column.title === field.title) return null;
  return {
    ...column,
    title: field.title,
    ...(field.options ? {
      uidt: 'SingleSelect',
      // Supported legacy options input. colOptions.options re-quotes PG defaults
      // and can issue ALTER TABLE even when the actual default is unchanged.
      dtxp: field.options.map(value => `'${value}'`).join(','),
      colOptions: null,
    } : {}),
  };
}

/** Stop before configuring a partial import. Never delete or repair unknown metadata. */
export function validateNocoCatalog(tables: Array<{id: string; table_name: string; columns: NocoColumn[]}>) {
  const byTable = new Map(tables.map(t => [t.id, t]));
  const byColumn = new Map(tables.flatMap(t => t.columns.map(c => [c.id, {column: c, table: t}] as const)));
  if (byTable.size !== tables.length || new Set(tables.map(t => t.table_name)).size !== tables.length) {
    throw new Error('linklab_noco_duplicate_table');
  }
  if (byColumn.size !== tables.reduce((n,t) => n + t.columns.length, 0)) throw new Error('linklab_noco_duplicate_column_id');
  for (const table of tables) {
    for (const key of ['column_name', 'title'] as const) {
      if (new Set(table.columns.map(c => c[key])).size !== table.columns.length) {
        throw new Error(`linklab_noco_duplicate_column:${table.table_name}:${key}`);
      }
    }
    for (const column of table.columns) {
      const options = column.colOptions as Record<string, string> | undefined;
      if (['Links', 'LinkToAnotherRecord'].includes(column.uidt)) {
        const related = options && byTable.get(options.fk_related_model_id);
        const child = options && byColumn.get(options.fk_child_column_id);
        const parent = options && byColumn.get(options.fk_parent_column_id);
        if (!related || !child || !parent || !['bt', 'hm'].includes(options!.type) ||
          child.table.id !== (options!.type === 'bt' ? table.id : related.id) ||
          parent.table.id !== (options!.type === 'bt' ? related.id : table.id)) {
          throw new Error(`linklab_noco_broken_relation:${table.table_name}:${column.title}`);
        }
      }
      if (column.uidt === 'Lookup') {
        const relation = options && byColumn.get(options.fk_relation_column_id);
        const target = options && byColumn.get(options.fk_lookup_column_id);
        const relationOptions = relation?.column.colOptions as Record<string, string> | undefined;
        if (!relation || !target || relation.table.id !== table.id ||
          !['Links', 'LinkToAnotherRecord'].includes(relation.column.uidt) ||
          relationOptions?.fk_related_model_id !== target.table.id) {
          throw new Error(`linklab_noco_broken_lookup:${table.table_name}:${column.title}`);
        }
      }
    }
  }
}
