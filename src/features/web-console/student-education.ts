export type EducationRow = { uni: string; faculty: string; grade: string; yearOfEnd: string; city?: string };
const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');

// Shared by the form and profile persistence. Does not read data or perform writes.
export function validateStudentEducation(input: unknown, noHigherEducation: boolean, currentYear: number) {
  const value: EducationRow[] = (Array.isArray(input) ? input : []).map(item => {
    const row = item && typeof item === 'object' ? item : {};
    return { uni: clean(row.uni), faculty: noHigherEducation ? '' : clean(row.faculty),
      grade: noHigherEducation ? '' : clean(row.grade), yearOfEnd: clean(row.yearOfEnd),
      ...(noHigherEducation ? { city: clean(row.city) } : {}) };
  });
  const errors: Record<string, boolean> = {};
  const required = noHigherEducation ? ['uni', 'yearOfEnd', 'city'] as const : ['uni', 'faculty', 'grade', 'yearOfEnd'] as const;
  for (const [index, row] of value.entries()) for (const field of required) {
    if (!row[field] || (field === 'yearOfEnd' && (!/^\d{4}$/.test(row[field]) || Number(row[field]) < 1960 || Number(row[field]) > currentYear + 6)))
      errors[`${index}.${field}`] = true;
  }
  const invalid = !value.length || value.length > (noHigherEducation ? 1 : 5) || Object.keys(errors).length > 0;
  return { value, errors, error: invalid ? noHigherEducation
    ? 'Укажите название учебного заведения, год окончания и город'
    : 'Заполните все поля высшего образования или отметьте «Нет высшего образования»' : '' };
}

export function educationText(entries: EducationRow[]): string {
  return entries.map(row => [row.uni, row.faculty, row.grade, row.yearOfEnd, row.city].filter(Boolean).join(', ')).filter(Boolean).join('; ');
}
