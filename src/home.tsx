// 홈과 이용안내(샘물 가져오기 동의 내용과 같음)
import { Page } from './ui.tsx';

export function HomePage({ start }: { start: string }) {
  return <div className="hero full"><div>
    <small>졸업 요건 확인·학기 계획</small>
    <h1>학점플래너</h1>
    <a className="cta" href={start}>검사하기</a>
  </div></div>;
}

// 이용 목적과 처리하는 항목
export const TERMS = <div className="policy">
  <h3>1. 이용 목적</h3>
  <p>졸업요건과 SM-CDR 트랙 인증 충족 여부를 확인하고, 남은 학기 계획을 짜는 데만 사용합니다. 수강 기록이 없는 학기는 휴학으로 보고 계산하며, 마이페이지에서 고칠 수 있습니다.</p>
  <h3>2. 가져오는 정보</h3>
  <ul>
    <li>학번, 이름, 학과, 입학구분, 다전공·부전공·마이크로전공, 유학생 여부</li>
    <li>이수한 과목과 이번 학기 수강 과목(학수번호, 과목명, 이수구분, 교양영역, 학점, 성적, 학기)</li>
    <li>전적대학 인정학점, 이수구분별 취득학점, 졸업 기준학점, 이번 학기 재수강 대상 과목</li>
    <li>SM-CDR 신청 트랙, 이수한 비교과 프로그램</li>
  </ul>
  <h3>3. 비밀번호</h3>
  <p>샘물 비밀번호는 로그인할 때 한 번만 사용하고 저장하지 않습니다.</p>
  <h3>4. 가져오지 않는 정보</h3>
  <p>이메일, 연락처, 생년월일 등은 가져오지 않습니다. 반복 로그인을 막기 위해 시도 횟수만 기록하며, 접속 IP와 학번은 알아볼 수 없는 값으로 바꿔 기록합니다.</p>
  <p className="muted">상명대학교 천안캠퍼스 학생 대상 · 2022~2026학번 교육과정 기준</p>
</div>;

export function TermsPage() {
  return <Page title="이용안내" narrow>
    <div className="box"><h2>개인정보 수집·이용</h2>{TERMS}
      <p className="small muted">졸업요건 판정은 학교 공식 판정이 아닙니다. 졸업 사정은 학과 사무실과 샘물에서 확인해 주세요.</p></div>
  </Page>;
}
