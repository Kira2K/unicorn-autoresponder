# Unipile V2 / LinkedIn profile capabilities

Санитизированная фиксация локального spike от 14 августа 2026 года. Документ не
содержит account IDs, имён, URL профиля, конкретных значений полей, секретов или
временных record IDs.

Обозначения:

- `live verified` — изменение было прочитано обратно; где возможно, исходное
  значение восстановлено;
- `read verified` — секция реально прочитана без изменения;
- `schema only` — операция присутствовала в документированной схеме, но live
  mutation не выполнялась;
- `unsupported` — штатной операции V2 не найдено.

## Profile Filler V1

| Раздел | Read | Standard mutation | Evidence | Ограничение |
| --- | --- | --- | --- | --- |
| Headline | Да | Update | live verified | Read-back обязателен |
| About | Да | Update | live verified | Read-back обязателен |
| Skills | Да | Add | live verified | Rename/delete unsupported; add-only |
| Experience | Да | Create/update | live verified | Delete unsupported; `notify_network=false` |
| Education | Да | Create/update | live verified | Delete unsupported; `notify_network=false` |
| Open to Work | Частично | Enable/configure | live verified | Документированного disable не найдено |

Именно эти шесть разделов входят в V1. Отсутствие штатного удаления означает,
что executor не обещает rollback созданной Experience/Education записи.
Неопределённый create нельзя автоматически повторять.

## За пределами V1

| Раздел | Evidence | Вывод |
| --- | --- | --- |
| Profile photo | live verified replace/read/restore | Standard replace работает; отдельного delete нет |
| Cover image | live verified replace/read/restore | Standard replace работает; отдельного delete нет |
| First/last name | schema only | Не включено в V1 |
| Location/postal code | schema only | Не включено в V1 |
| Custom link | schema only | Отдельного delete не подтверждено |
| Image filters/positioning | schema only | Не включено в V1 |
| Languages | read verified | Standard update отсутствует |
| Interests | read verified | Standard update отсутствует |
| Licenses & Certifications | read verified | Standard create/update/delete отсутствует |
| Volunteer Experience | read verified | Standard create/update/delete отсутствует |
| Projects | read verified | Standard create/update/delete отсутствует |
| Recommendations | schema/read route only | Mutation отсутствует |
| Courses | unsupported in observed profile sections | Не включать без нового исследования |

## Safety conclusions

- Standard Unipile V2 используется по умолчанию.
- Raw/Magic Route не является автоматическим fallback и требует отдельного
  разрешения, отдельной схемы и live-теста.
- 2xx не считается успехом без свежего read-back.
- IDs sections/search parameters берутся из текущего аккаунта и не переносятся
  между профилями.
- Документ фиксирует возможности на дату spike, а не гарантирует неизменность
  LinkedIn/Unipile API. Перед live-релизом матрица повторно сверяется с текущей
  официальной схемой.
