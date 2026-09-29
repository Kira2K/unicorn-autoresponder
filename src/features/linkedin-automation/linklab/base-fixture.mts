import type { SqlSession } from '../../../integrations/postgres/contracts.mts';

/** Session-local fixtures only; no source table is written. */
export async function createLinkLabFixture(session: SqlSession) {
  await session.query(`CREATE TEMP TABLE clients (
    id bigint PRIMARY KEY, client_name text, "01_stacks_id" bigint, __nc_deleted boolean);
    CREATE TEMP TABLE platforms (id bigint PRIMARY KEY, name text, __nc_deleted boolean);
    CREATE TEMP TABLE stacks (id bigint PRIMARY KEY, name text, __nc_deleted boolean);
    CREATE TEMP TABLE platform_accounts (
      id bigint PRIMARY KEY, clients_id bigint, platforms_id bigint DEFAULT 16, url text,
      login text DEFAULT 'fixture-user', password text DEFAULT 'fixture-password', __nc_deleted boolean);
    INSERT INTO pg_temp.platforms VALUES (16, 'LinkedIn', false), (17, 'hh', false);
    INSERT INTO pg_temp.stacks VALUES (1, 'Python / Юникод', false), (2, 'GO', false), (3, 'Old', true);
    INSERT INTO pg_temp.clients VALUES
      (1, 'Тест Однофамилец', 1, false), (2, 'Тест Однофамилец', 2, false),
      (3, 'No password', 1, false), (4, 'No login', 1, false), (5, 'Whitespace', 1, false),
      (6, 'Null URL', null, false), (7, 'Empty URL', null, false), (8, 'One link', 1, false),
      (9, 'Two links', 1, false), (10, 'Incomplete linked account', 1, false),
      (11, 'Deleted client', 1, true), (12, 'Deleted account', 1, false), (13, 'Other platform', 1, false),
      (14, 'Deleted stack', 3, false), (15, 'Missing stack', 999, false), (16, 'No account', 1, false),
      (17, 'Two placeholders', 1, false), (18, 'Misleading host', 1, false),
      (19, 'Both incomplete', 1, false), (20, 'Null deletion marker', 1, null),
      (9007199254740993, 'Big ID', 1, false);
    INSERT INTO pg_temp.platform_accounts (id, clients_id, url) VALUES
      (10, 1, 'https://www.linkedin.com/in/one/'), (20, 2, 'linkedin.com/in/two'),
      (30, 3, null), (40, 4, null), (50, 5, null), (60, 6, null), (70, 7, ''),
      (80, 8, null), (81, 8, ' linkedin.com/in/eight/ '),
      (90, 9, 'linkedin.com/in/nine-a'), (91, 9, 'linkedin.com/in/nine-b'),
      (100, 10, null), (101, 10, 'linkedin.com/in/ten'),
      (110, 11, null), (120, 12, null), (130, 13, null), (140, 14, null), (150, 15, null),
      (170, 17, '-'), (171, 17, ''),
      (180, 18, 'https://linkedin.com.evil.invalid/in/bogus'), (181, 18, 'HTTPS://WWW.LINKEDIN.COM/in/real'),
      (190, 19, null), (191, 19, 'linkedin.com/in/nineteen'), (200, 20, null),
      (999, 999, null), (9007199254740993, 9007199254740993, 'linkedin.com/in/big');
    UPDATE pg_temp.platform_accounts SET password = null WHERE id IN (30, 101, 190);
    UPDATE pg_temp.platform_accounts SET login = '' WHERE id IN (40, 191);
    UPDATE pg_temp.platform_accounts SET password = E' \t\n' WHERE id = 50;
    UPDATE pg_temp.platform_accounts SET __nc_deleted = true WHERE id = 120;
    UPDATE pg_temp.platform_accounts SET platforms_id = 17 WHERE id = 130;`);
}
