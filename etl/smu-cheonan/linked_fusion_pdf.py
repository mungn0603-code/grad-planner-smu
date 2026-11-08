"""천안 연계·융합전공 교육과정표 PDF → raw/linked-fusion.json (학수번호·과목명·학점·이수구분·학년·학기).

사용(저장소 루트에서):
  pip install -r etl/requirements.txt
  python etl/smu-cheonan/linked_fusion_pdf.py --download   # PDF를 etl/smu-cheonan/raw/pdf/ 에 받는다(git 제외)
  python etl/smu-cheonan/linked_fusion_pdf.py              # 받아 둔 PDF로 raw/linked-fusion.json 을 다시 만든다
같은 PDF면 같은 결과가 나온다. 그다음 node etl/smu-cheonan/major-system.ts 로 카탈로그·세트를 만든다.

읽는 방법: pypdf로 쪽마다 글자를 뽑아 공백을 하나로 모은 뒤, 표 한 줄
  번호 학년 학기 이수구분 학수번호 교과목명 영문명 개설학과 주관학과 [담당교수] 학점 [P/F면 Y] 이론 실습 분반 ...
을 정규식으로 읽는다. 과목명은 저장소 학과 교육과정에 같은 학수번호가 있으면 그 이름(학교 교육과정 원문),
없으면 영문명 앞의 한글 부분을 쓰고 표 칸 줄바꿈으로 생긴 띄어쓰기를 붙인다.
과목명·이수구분·학점은 학생 기록에서는 샘물 값을 쓰므로(ADR 0016) 여기 이름은 추천 화면용이다. 손으로 다듬지 않는다.
"""
import json
import os
import re
import sys
import urllib.request

from pypdf import PdfReader

ROOT = os.path.dirname(os.path.abspath(__file__))
PDF_DIR = os.path.join(ROOT, 'raw', 'pdf')
OUT = os.path.join(ROOT, 'raw', 'linked-fusion.json')
GEN = os.path.join(ROOT, '..', '..', 'data', 'smu-cheonan', 'gen')
BASE = 'https://www.smu.ac.kr/board/haksa/ycurri.do?mode=download'
# 파일 이름(앞 4자리 = 교육과정 학년도) → 게시글·첨부 번호. 학사 게시판 '연계전공 및 융합전공 교육과정'(ycurri.do) 천안캠퍼스
FILES = {
    '2026-linked.pdf': '762824&attachNo=554354', '2026-fusion.pdf': '762824&attachNo=555577',
    '2025-linked.pdf': '760282&attachNo=551515', '2025-fusion.pdf': '760282&attachNo=551516',
    '2024-globaldata.pdf': '751528&attachNo=541110', '2024-robotai.pdf': '751528&attachNo=541111',
    '2024-bigdata.pdf': '751528&attachNo=541112', '2024-globalmkt.pdf': '751528&attachNo=541113',
    '2024-transmedia.pdf': '751528&attachNo=541114', '2024-smartliving.pdf': '751528&attachNo=541115',
    # 751528 attachNo=541116 '[콘텐츠제작연계전공]2023학년도'는 천안 게시글에 섞인 서울캠퍼스 표라 뺀다
    # (학수번호 HA…, 주관 한일문화콘텐츠전공, 서울 교육과정 책자 70쪽. 글꼴에 글자 정보도 없다)
    '2024-storytelling.pdf': '751528&attachNo=541117',
    '2024-globalculture.pdf': '751528&attachNo=541118', '2024-smartgame.pdf': '751528&attachNo=542561',
    '2024-lifestyle.pdf': '751528&attachNo=542562', '2023-smartwebapp.pdf': '751528&attachNo=542563',
    '2023-digitalbiz.pdf': '751528&attachNo=542564', '2024-globalcomm.pdf': '751528&attachNo=542565',
}
HAN = re.compile(r'[가-힣]')
ROW = re.compile(r'(?:^|\s)(\d{1,3}) (전체|[1-4]) (1학기|2학기|하계|동계|전체) (\S+) (HB[A-Z0-9]{6}) (.*?) (\d+\.\d)(?: Y)? (\d+\.\d) (\d+\.\d) (\d+) [YN] ')
SEC = re.compile(r'소속 ?: ?천안캠퍼스 (\S+) (?:\S+ )?(\S+전공) ')


def known_names() -> dict:
    """학과·교양 교육과정의 과목명(연계·융합 카탈로그는 이 스크립트의 결과라 뺀다)."""
    out = {}
    for f in sorted(os.listdir(GEN)):
        if f.startswith(('lk-', 'fu-')):
            continue
        c = json.load(open(os.path.join(GEN, f), encoding='utf-8'))
        for rows in c.get('editions', {}).values():
            for r in rows:
                out.setdefault(r['c'], r['n'])
    return out


def ko_name(rest: str) -> str:
    """'교과목명 영문명 개설학과 …'에서 한글 교과목명. 이름 안의 짧은 영문 약어(IoT, MICE, CMF)와 & 같은 연결 기호는 이름에 넣는다."""
    toks, out, seen = rest.split(' '), [], False
    for i, t in enumerate(toks):
        nxt = toks[i + 1] if i + 1 < len(toks) else ''
        if HAN.search(t) or not seen:
            out.append(t); seen = seen or bool(HAN.search(t))
        elif HAN.search(nxt) and (t in ('&', '·', '-', '+') or len(t) <= 4 or t == t.upper()):
            out.append(t)
        else:
            break
    return ' '.join(out).strip()


def clean(n: str) -> str:
    n = re.sub(r'\([^)]*$', '', n).strip()          # 잘린 괄호 꼬리 "(S"
    n = re.sub(r'\( ', '(', re.sub(r' \)', ')', n))
    toks, out = n.split(' '), []
    for t in toks:  # 표 칸 너비(한글 약 10자)에서 줄이 바뀌어 생긴 띄어쓰기만 붙인다
        if out and len(out[-1]) >= 9 and HAN.match(out[-1][-1]) and t and HAN.match(t[0]):
            out[-1] += t
        else:
            out.append(t)
    return ' '.join(out)


def download():
    os.makedirs(PDF_DIR, exist_ok=True)
    for f, a in FILES.items():
        urllib.request.urlretrieve(f'{BASE}&articleNo={a}', os.path.join(PDF_DIR, f))
        print('받음', f)


def extract():
    known, result = known_names(), {}
    for f in sorted(FILES):
        text = re.sub(r'\s+', ' ', ' '.join((p.extract_text() or '') for p in PdfReader(os.path.join(PDF_DIR, f)).pages))
        parts = SEC.split(text)
        for k in range(1, len(parts), 3):
            college, prog, body = parts[k], parts[k + 1], parts[k + 2]
            e = result.setdefault(prog, {'college': college, 'src': [], 'editions': {}})
            url = f'{BASE}&articleNo={FILES[f]}'
            if url not in e['src']:
                e['src'].append(url)
            ed = e['editions'].setdefault(f[:4], [])
            have = {x['c'] for x in ed}
            for m in ROW.finditer(body):
                grade, term, cat, code, rest, cr = m.group(2), m.group(3), m.group(4), m.group(5), m.group(6), float(m.group(7))
                if code in have:  # 같은 학수번호가 두 번 나오면 처음 것만
                    continue
                r = {'c': code, 'n': known.get(code) or clean(ko_name(rest)), 'cr': cr, 't': cat}
                if grade != '전체':
                    r['y'] = int(grade)
                if term in ('1학기', '2학기'):
                    r['s'] = int(term[0])
                ed.append(r); have.add(code)
    unread = [f for f in sorted(FILES) if not any(f'{BASE}&articleNo={FILES[f]}' in e['src'] for e in result.values())]
    if unread:
        raise SystemExit(f'과목 표를 읽지 못한 PDF: {unread}')
    doc = {
        'note': '상명대 학사 게시판 연계·융합전공 교육과정(ycurri.do) 천안캠퍼스 PDF. etl/smu-cheonan/linked_fusion_pdf.py 가 만든다',
        'excluded': ['751528 attachNo=541116 [콘텐츠제작연계전공]2023학년도: 천안 게시글에 섞인 서울캠퍼스 표(학수번호 HA…, 주관 한일문화콘텐츠전공)'],
        'programs': result,
    }
    with open(OUT, 'w', encoding='utf-8', newline='\n') as w:
        json.dump(doc, w, ensure_ascii=False, indent=1)
        w.write('\n')
    for prog, e in result.items():
        print(prog, {y: len(r) for y, r in e['editions'].items()})
    print('읽지 못한 PDF:', unread)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    if '--download' in sys.argv:
        download()
    extract()
