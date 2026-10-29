"""Create a private, Cyrillic E2E report. No credentials are accepted on the command line."""
import argparse
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image, KeepTogether

def create_report(report_path, output, private_path=None):
    report = json.loads(Path(report_path).read_text(encoding='utf-8'))
    private = json.loads(Path(private_path).read_text(encoding='utf-8')) if private_path else {}
    font = Path('C:/Windows/Fonts/arial.ttf')
    bold = Path('C:/Windows/Fonts/arialbd.ttf')
    if not font.exists() or not bold.exists():
        raise ValueError('Cyrillic fonts are required')
    pdfmetrics.registerFont(TTFont('Report', str(font)))
    pdfmetrics.registerFont(TTFont('ReportBold', str(bold)))
    pdfmetrics.registerFontFamily('Report', normal='Report', bold='ReportBold')
    styles = getSampleStyleSheet()
    for name in ['Normal', 'BodyText', 'Title', 'Heading1', 'Heading2']:
        styles[name].fontName = 'ReportBold' if name.startswith('Heading') or name == 'Title' else 'Report'
    styles['BodyText'].fontSize = 10
    styles['BodyText'].leading = 15
    styles['BodyText'].spaceAfter = 7
    styles['Title'].fontSize = 23
    styles['Title'].leading = 29
    styles.add(ParagraphStyle('SmallReport', parent=styles['BodyText'], fontSize=8, leading=11, textColor=colors.HexColor('#475569')))
    story = []
    def p(text, style='BodyText'):
        story.append(Paragraph(escape(str(text)).replace('\n', '<br/>'), styles[style]))
    p('Проверка полного цикла LinkedIn', 'Title')
    p('Первый аккаунт - блокировка - повторное оформление', 'Heading2')
    date = datetime.now(timezone(timedelta(hours=4))).strftime('%d.%m.%Y %H:%M')
    p(f'Отчёт сформирован: {date}, Тбилиси', 'SmallReport')
    success = report.get('passed') and report.get('manualClientId')
    warning_approved = bool(report.get('warningDeliveryApprovedAt')) and report.get('completedCycles') == [1, 2]
    manual_available = bool(report.get('manualClientId') and private.get('manualLogin') and private.get('manualPassword'))
    p('ОБЩИЙ РЕЗУЛЬТАТ: ПРОЙДЕНО' if success else 'ОБЩИЙ РЕЗУЛЬТАТ: НЕ ПРИНЯТ', 'Heading1')
    p('Пользовательские циклы: два цикла завершены.' if report.get('completedCycles') == [1, 2] else 'Пользовательские циклы: проверка не завершена.')
    failed_checks = [check for check in report.get('checks', []) if check.get('state') != 'passed']
    p('Проверки с ошибкой или блокировкой: ' + (', '.join(check['step'] for check in failed_checks) or 'нет'))
    if warning_approved:
        p('Отправка отчёта с предупреждением согласована отдельно. Это не означает успешную проверку целостности БД.')
    p('Настоящие Outlook и LinkedIn не регистрировались. Внешние реквизиты синтетические. Проверялись наш кабинет, рабочая БД, Octo и подключения прокси.')
    p(f"Пройденные циклы: {', '.join(map(str, report.get('completedCycles', []))) or 'пока нет'}. Тестовый ученик: {report.get('clientId', 'не создан')}.")
    if manual_available:
        start = len(story)
        p('Твой пользователь для ручной проверки', 'Heading1')
        p(f"ФИО: Илья Проверкин\nКабинет: https://very-evil-unicorn.onrender.com/\nЛогин: {private['manualLogin']}\nПароль кабинета: {private['manualPassword']}")
        p('Это чистый кабинет: LinkedIn, Outlook-анкета, заявки и Octo-профили ещё не созданы. ФИО сохранено кириллицей. Название будущих Octo-профилей проверено правилом, а не на живом профиле.')
        story[start:] = [KeepTogether(story[start:])]
    else:
        p('Отдельный ручной пользователь пока не создан: по согласованному правилу он появляется только после полностью успешной live-проверки. Уведомление об успехе не отправлено.')
    for finding in report.get('findings', []):
        p(finding)
    p('CRM ПОКА НЕ ПОДКЛЮЧАЕМ. ЕЁ ЛОГИКУ НУЖНО ОБНОВИТЬ ДЛЯ НОВЫХ ЦИКЛОВ И КОНКРЕТНЫХ LINKEDIN-АККАУНТОВ.', 'SmallReport')
    story.append(PageBreak())
    p('Как пройти тот же путь самостоятельно', 'Heading1')
    steps = [
        ('Войти в кабинет', ('Используй данные выше.' if manual_available else 'Чистый ручной кабинет пока не создан. После выпуска исправления и успешной повторной проверки будут выданы отдельные данные входа.') + ' Если появится уведомление о новом браузере, нажми «Понятно, продолжить».'),
        ('Начать оформление', 'В разделе LinkedIn выбери «Нет LinkedIn / аккаунт заблокирован». Данные Outlook доступны без внешнего аккордеона.'),
        ('Заполнить анкету', 'Укажи адрес почты, пароль и время регистрации в прошлом; имя и фамилию латиницей. Локация берётся из личных данных, но правка здесь не меняет личный профиль. Если отметишь заблокированные аккаунты, заполни все поля каждого аккаунта. В E2E используются синтетические реквизиты.'),
        ('Сохранить заявку', 'Нажми «Сохранить и подготовить Octo». Появится сообщение, что аккаунт создаётся. Повторную заявку во время ожидания оформить нельзя.'),
        ('Выполнить работу Дениса', 'В кабинете Дениса открой эту заявку. Введи новый работающий прокси в нашей форме и нажми «Сохранить прокси». Дождись сохранения; затем можно получить доступ к EN-профилю Octo.'),
        ('Закончить работу с Octo', 'Открой профиль в гостевом Octo с выданным паролем, закрой обычным способом и дождись завершения доступа. Затем нажми «Сохранить настройки прокси» в кабинете Дениса.'),
        ('Сохранить результат', 'Укажи ссылку LinkedIn отдельно от логина, сохрани результат и выбери «сделана экспертом». В главном кабинете открой LinkedIn и нужную заявку, нажми «Подтвердить выполнение». Отдельно дождись сообщения об отправленном уведомлении. У Дениса этой кнопки нет.'),
        ('Проверить повторное оформление', 'Нажми «Меня забанили»: появится инструкция по восстановлению, заявка ещё не создаётся. Для повторного оформления выбери «Прошла неделя — подать заявку», укажи новую Outlook-почту и повтори процесс. Для второго LinkedIn нужен другой прокси; RU-профиль сохраняется.'),
    ]
    for i, (title, description) in enumerate(steps, 1):
        p(f'{i}. {title}', 'Heading2');p(description)
    story.append(PageBreak())
    p('Что фактически проверено', 'Heading1')
    labels = {'passed':'ПРОЙДЕНО', 'failed':'ОШИБКА', 'blocked':'ЗАБЛОКИРОВАНО'}
    for check in report.get('checks', []):
        start = len(story)
        p(f"{labels.get(check['state'], check['state'])}: {check['step']}", 'Heading2')
        p('Ожидали: ' + check['expected'])
        p('Получили: ' + check['actual'])
        p('Время UTC: ' + check['at'], 'SmallReport')
        if check.get('db'):
            p('Проверка БД: ' + json.dumps(check['db'], ensure_ascii=False), 'SmallReport')
        story[start:] = [KeepTogether(story[start:])]
    screenshots = [Path(c['screenshot']) for c in report.get('checks', []) if c.get('screenshot') and Path(c['screenshot']).is_file()]
    if screenshots:
        story.append(PageBreak());p('Подтверждающие снимки', 'Heading1')
        for image in screenshots:
            start = len(story)
            p(image.stem, 'Heading2')
            im = Image(str(image));im._restrictSize(480, 540);story.append(im);story.append(Spacer(1, 12))
            story[start:] = [KeepTogether(story[start:])]
    output = Path(output);output.parent.mkdir(parents=True, exist_ok=True)
    def footer(canvas, doc):
        canvas.setFont('Report', 8);canvas.setFillColor(colors.HexColor('#64748b'))
        canvas.drawString(40, 23, 'E2E LinkedIn | приватный отчёт')
        canvas.drawRightString(A4[0]-40, 23, str(doc.page))
    SimpleDocTemplate(str(output), pagesize=A4, leftMargin=40, rightMargin=40, topMargin=38, bottomMargin=38).build(story, onFirstPage=footer, onLaterPages=footer)
    return output

if __name__ == '__main__':
    parser = argparse.ArgumentParser();parser.add_argument('--report', required=True);parser.add_argument('--output', required=True);parser.add_argument('--private')
    args = parser.parse_args();path = create_report(args.report, args.output, args.private)
    print(json.dumps({'pdf':str(path)}, ensure_ascii=False))
