// Vercel 서버리스 함수 — 한국천문연구원 특일 정보를 모아 한 번에 돌려주고 인증키를 숨긴다

// 한국천문연구원 특일 정보 서비스의 기본 주소다
const BASE_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService";

// 한 번에 함께 불러올 조회 종류다 (공휴일 / 기념일 / 24절기 / 잡절)
const OPERATIONS = [
  { key: "holidays",      op: "getRestDeInfo",       label: "공휴일" },
  { key: "anniversaries", op: "getAnniversaryInfo",  label: "기념일" },
  { key: "divisions",     op: "get24DivisionsInfo",  label: "24절기" },
  { key: "sundries",      op: "getSundryDayInfo",    label: "잡절" }
];

// 공공데이터포털 결과 코드를 한국어 안내 문구로 바꿔주는 표다
const RESULT_MESSAGES = {
  "01": "제공 기관 서비스에 오류가 있습니다. 잠시 후 다시 시도해주세요.",
  "02": "공공데이터포털 서버에 오류가 있습니다. 잠시 후 다시 시도해주세요.",
  "03": "조회된 자료가 없습니다.",
  "04": "요청 변수에 문제가 있습니다. 연도와 월을 확인해주세요.",
  "10": "잘못된 요청 변수가 있습니다. 연도와 월을 확인해주세요.",
  "12": "중단된 서비스입니다. API 상태를 확인해주세요.",
  "20": "접근이 거부되었습니다. 활용 신청이 승인되었는지 확인해주세요.",
  "22": "일일 트래픽 한도를 초과했습니다. 내일 다시 시도해주세요.",
  "30": "등록되지 않은 인증키입니다. HOLIDAY_KEY 값을 확인해주세요.",
  "31": "인증키 사용 기간이 만료되었습니다. 공공데이터포털에서 연장해주세요.",
  "32": "등록되지 않은 IP 에서의 요청입니다.",
  "99": "알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
};

// 환경변수 값의 앞뒤 공백을 없애고, Encoding 키를 넣었더라도 Decoding 상태로 되돌린다
function normalizeKey(rawKey) {
  const trimmed = String(rawKey).trim();      // 붙여넣을 때 섞여 들어간 공백·줄바꿈을 없앤다
  try {
    return decodeURIComponent(trimmed);       // %가 섞인 Encoding 키라면 원래 값으로 돌아온다
  } catch {
    return trimmed;                           // 디코딩이 불가능한 형태면 그대로 쓴다
  }
}

// 인증키 오류일 때 키 자체를 노출하지 않고 모양만 알려주는 진단 정보를 만든다
function describeKey(key) {
  return {
    길이: key.length,                                   // 정상이라면 64자다
    형식: /^[0-9a-zA-Z+/=%._-]+$/.test(key) ? "정상 문자" : "허용되지 않는 문자 포함",
    공백포함: /\s/.test(key),                            // 가운데에 공백이 끼었는지 본다
    끝4자리: key.length >= 4 ? key.slice(-4) : "짧음"     // 어느 키인지 구분할 수 있게 끝 4자리만 보여준다
  };
}

// 이 API 는 결과가 0건이면 items 가 빈 문자열, 1건이면 객체, 여러건이면 배열로 와서 모양을 통일해야 한다
function toArray(items) {
  if (!items || typeof items !== "object") return [];        // 0건일 때는 "" 가 오므로 빈 배열로 만든다
  const item = items.item;                                   // 실제 목록은 item 안에 들어 있다
  if (!item) return [];                                      // item 이 없으면 빈 배열이다
  return Array.isArray(item) ? item : [item];                // 1건이면 객체이므로 배열로 감싼다
}

// API 가 주는 20260216 형태의 숫자를 화면에서 쓰기 쉬운 형태로 바꾼다
function normalizeItem(raw) {
  const locdate = String(raw.locdate ?? "");                 // 숫자로 오므로 문자열로 바꾼다
  return {
    date: `${locdate.slice(0, 4)}-${locdate.slice(4, 6)}-${locdate.slice(6, 8)}`, // 2026-02-16 형태다
    day: Number(locdate.slice(6, 8)),                        // 달 안에서의 일자다
    name: String(raw.dateName ?? "").trim(),                 // 공휴일·기념일 이름이다
    isHoliday: String(raw.isHoliday ?? "").trim() === "Y",   // 법정 공휴일(쉬는 날) 여부다
    time: String(raw.kst ?? "").trim() || null               // 절기 시각은 뒤에 공백이 붙어 오므로 다듬는다
  };
}

// 조회 한 종류를 호출해 정리된 목록을 돌려준다
async function fetchOne(op, key, year, month) {
  const params = new URLSearchParams({
    serviceKey: key,         // Decoding 상태로 정리한 인증키다
    solYear: String(year),   // 조회할 연도다
    numOfRows: "100",        // 한 달 기준으로 충분한 개수다
    pageNo: "1",             // 첫 번째 페이지를 요청한다
    _type: "json"            // 이 API 는 XML 이 기본이라 JSON 을 따로 요청해야 한다
  });
  if (month) params.set("solMonth", String(month).padStart(2, "0")); // 월은 두 자리로 맞춘다

  const response = await fetch(`${BASE_URL}/${op}?${params}`, { signal: AbortSignal.timeout(10000) });
  const text = await response.text();                        // JSON 인지 XML 인지 모르므로 글자로 받는다

  let data;
  try {
    data = JSON.parse(text);                                 // 정상이라면 JSON 으로 해석된다
  } catch {
    throw new Error("인증키 또는 요청값을 확인해주세요");      // XML 오류 응답인 경우다
  }

  // 인증키 문제는 모양이 다른 JSON(OpenAPI_ServiceResponse)으로 오므로 먼저 확인한다
  const gateway = data?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (gateway) {
    throw new Error(RESULT_MESSAGES[gateway.returnReasonCode] || "인증키 또는 요청값을 확인해주세요");
  }

  // 응답 본문의 결과 코드를 확인한다
  const resultCode = data?.response?.header?.resultCode;
  if (resultCode !== "00") {
    throw new Error(RESULT_MESSAGES[resultCode] || "인증키 또는 요청값을 확인해주세요");
  }

  // 모양을 통일한 뒤 날짜 순서로 정렬해 돌려준다
  return toArray(data?.response?.body?.items).map(normalizeItem).sort((a, b) => a.date.localeCompare(b.date));
}

// Vercel 이 요청을 받을 때 실행하는 기본 처리 함수다
export default async function handler(req, res) {
  // GET 이외의 방식으로 들어온 요청은 받지 않는다
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, message: "GET 방식으로만 요청할 수 있습니다." });
  }

  // 주소 쿼리에서 연도와 월을 꺼낸다 (req.query 가 없는 환경을 대비해 직접 파싱도 준비한다)
  const fallback = new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams;
  const now = new Date();                                                            // 기본값으로 쓸 오늘 날짜다
  const year = Number(req.query?.year ?? fallback.get("year") ?? now.getFullYear()); // 연도가 없으면 올해다
  const monthRaw = req.query?.month ?? fallback.get("month");                        // 월은 생략할 수 있다
  const month = monthRaw === null || monthRaw === undefined || monthRaw === "" || monthRaw === "0"
    ? null                                                                           // 월이 없으면 1년 전체를 조회한다
    : Number(monthRaw);

  // 연도가 API 가 제공하는 범위를 벗어나면 거절한다
  if (!Number.isInteger(year) || year < 2004 || year > 2050) {
    return res.status(400).json({ ok: false, message: "연도는 2004년부터 2050년 사이로 입력해주세요." });
  }

  // 월이 1~12 가 아니면 거절한다
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return res.status(400).json({ ok: false, message: "월은 1부터 12 사이로 입력해주세요." });
  }

  // 인증키는 코드가 아니라 환경변수에서만 읽는다
  const rawKey = process.env.HOLIDAY_KEY;
  if (!rawKey) {
    return res.status(500).json({ ok: false, message: "서버에 인증키(HOLIDAY_KEY)가 설정되지 않았습니다." });
  }
  const key = normalizeKey(rawKey);

  try {
    // 네 가지 조회를 동시에 보내 응답 시간을 줄인다
    const results = await Promise.all(OPERATIONS.map(({ op }) => fetchOne(op, key, year, month)));

    // 조회 종류별로 결과를 담는다
    const payload = { ok: true, year, month };
    OPERATIONS.forEach(({ key: name }, index) => { payload[name] = results[index]; });

    // 같은 달의 자료는 자주 바뀌지 않으므로 1시간 동안 재사용해 호출 한도를 아낀다
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");

    return res.status(200).json(payload);
  } catch (error) {
    // 시간 초과나 네트워크 오류인 경우다
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return res.status(504).json({ ok: false, message: "특일 정보 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요." });
    }
    // 인증키 문제로 보이는 오류에는 키의 모양만 덧붙여 원인을 찾기 쉽게 한다
    const payload = { ok: false, message: error.message || "정보를 불러오지 못했습니다." };
    if (String(error.message).includes("인증키")) payload.진단 = describeKey(key);
    return res.status(502).json(payload);
  }
}
