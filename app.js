/* ===== 설정 값 ===== */

// 인증키는 서버에만 두므로 이 파일에는 주소만 적는다 (호출은 서버리스 함수가 대신한다)
const API_URL = "/api/holiday";

// 화면에 보여줄 목록의 종류와 제목을 정리한 표다
const SECTIONS = [
  { key: "holidays",      title: "공휴일 (빨간날)" },
  { key: "anniversaries", title: "기념일" },
  { key: "divisions",     title: "24절기" },
  { key: "sundries",      title: "잡절" }
];

// 달력 점 색에 쓰일 종류 이름이다 (공휴일은 배경색으로 표시하므로 제외한다)
const DOT_KEYS = ["anniversaries", "divisions", "sundries"];

// API 가 자료를 제공하는 연도 범위다
const MIN_YEAR = 2004;
const MAX_YEAR = 2050;

// 손가락으로 이만큼(px) 이상 밀면 달을 넘긴다
const SWIPE_THRESHOLD = 60;

/* ===== 화면 요소 가져오기 ===== */

// 현재 보고 있는 연·월을 보여주는 글자 요소다
const monthLabel = document.getElementById("monthLabel");
// 이전 달로 가는 화살표 버튼이다
const prevBtn = document.getElementById("prevBtn");
// 다음 달로 가는 화살표 버튼이다
const nextBtn = document.getElementById("nextBtn");
// 오늘이 있는 달로 되돌아가는 버튼이다
const todayBtn = document.getElementById("todayBtn");
// 달을 넘길 때 좌우로 미끄러지는 영역이다
const stage = document.getElementById("stage");
// 요약 카드의 설명 글 요소다
const summaryLabel = document.getElementById("summaryLabel");
// 요약 카드의 큰 숫자 요소다
const summaryValue = document.getElementById("summaryValue");
// 요약 카드의 보조 문구 요소다
const summarySub = document.getElementById("summarySub");
// 로딩·오류 안내 문구 요소다
const statusEl = document.getElementById("status");
// 달력 전체를 감싸는 요소다
const calendarEl = document.getElementById("calendar");
// 날짜 칸이 들어갈 요소다
const daysEl = document.getElementById("days");
// 목록 카드들이 들어갈 요소다
const listsEl = document.getElementById("lists");

/* ===== 현재 상태 ===== */

// 지금 보고 있는 연도와 월을 담아둔다
const state = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };

// 같은 달을 두 번 불러오지 않도록 받아온 자료를 보관한다
const cache = new Map();

// 조회가 겹칠 때 늦게 도착한 옛 응답이 화면을 덮지 않도록 요청 번호를 센다
let requestId = 0;

/* ===== 공통 도우미 함수 ===== */

// HTML에 값을 넣을 때 태그로 해석되지 않도록 특수문자를 바꿔준다
function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

// 안내 문구를 보여준다 (isError가 true면 빨간색으로 강조한다)
function showStatus(message, isError = false) {
  statusEl.textContent = message;                 // 문구를 바꾼다
  statusEl.classList.remove("hidden");            // 숨김을 해제한다
  statusEl.classList.toggle("error", isError);    // 오류 여부에 따라 색을 바꾼다
}

// 안내 문구를 숨긴다
function hideStatus() {
  statusEl.classList.add("hidden");               // 안내 문구 영역을 감춘다
}

// 절기 시각으로 오는 "0502" 형태를 "05:02"로 바꾼다
function formatTime(time) {
  if (!time || time.length < 3) return null;                  // 시각 정보가 없으면 건너뛴다
  const padded = time.padStart(4, "0");                       // 네 자리로 맞춘다
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;       // 시와 분 사이에 콜론을 넣는다
}

/* ===== API 호출 ===== */

// 선택한 연·월의 특일 정보를 우리 서버(/api/holiday)에서 받아온다
async function fetchHolidayData(year, month) {
  const cacheKey = `${year}-${month}`;                     // 보관함에서 쓸 열쇠다
  if (cache.has(cacheKey)) return cache.get(cacheKey);     // 이미 받아둔 달이면 그대로 쓴다

  const params = new URLSearchParams({ year, month });     // 서버에 넘길 연도와 월이다

  const response = await fetch(`${API_URL}?${params}`);    // 우리 서버리스 함수를 호출한다
  const data = await response.json().catch(() => null);    // 응답을 JSON 으로 해석한다 (실패하면 null 이다)

  if (!response.ok || !data?.ok) {                         // 서버가 오류를 돌려준 경우다
    throw new Error(data?.message || "서버에서 정보를 가져오지 못했습니다."); // 서버가 보낸 한국어 메시지를 쓴다
  }

  cache.set(cacheKey, data);                               // 다음에 다시 쓰도록 보관한다
  return data;                                             // 정리된 자료를 돌려준다
}

/* ===== 화면 그리기 ===== */

// 날짜별로 어떤 특일이 있는지 모아둔 지도를 만든다
function buildDayMap(data) {
  const map = new Map();                                           // 일자를 열쇠로 쓰는 지도다

  SECTIONS.forEach(({ key }) => {                                  // 네 가지 종류를 모두 돌면서
    (data[key] || []).forEach((item) => {                          // 그 종류의 항목을 하나씩 본다
      if (!map.has(item.day)) {                                    // 그 날짜가 처음이면
        map.set(item.day, { holiday: false, names: [], kinds: new Set() }); // 빈 칸을 만든다
      }
      const slot = map.get(item.day);                              // 해당 날짜의 칸을 가져온다
      if (item.isHoliday) slot.holiday = true;                     // 하루라도 공휴일이면 빨간날로 표시한다
      if (item.isHoliday) slot.names.unshift(item.name);           // 공휴일 이름을 앞쪽에 둔다
      else slot.names.push(item.name);                             // 그 밖의 이름은 뒤에 붙인다
      slot.kinds.add(key);                                         // 종류를 기록해 점 색을 정한다
    });
  });

  return map;                                                      // 완성된 지도를 돌려준다
}

// 선택한 연·월의 달력을 그린다
function renderCalendar(year, month, dayMap) {
  const firstWeekday = new Date(year, month - 1, 1).getDay();      // 1일이 무슨 요일인지 구한다 (0=일요일)
  const lastDay = new Date(year, month, 0).getDate();              // 그 달의 마지막 날짜를 구한다
  const today = new Date();                                        // 오늘 날짜를 가져온다
  const isThisMonth = today.getFullYear() === year && today.getMonth() + 1 === month; // 이번 달인지 확인한다

  const cells = [];                                                // 날짜 칸 HTML 을 모을 배열이다

  for (let i = 0; i < firstWeekday; i += 1) {                      // 1일 앞의 빈 칸을 채운다
    cells.push('<div class="day empty"></div>');
  }

  for (let day = 1; day <= lastDay; day += 1) {                    // 1일부터 마지막 날까지 돈다
    const weekday = new Date(year, month - 1, day).getDay();       // 그 날의 요일을 구한다
    const info = dayMap.get(day);                                  // 그 날의 특일 정보를 가져온다

    const classes = ["day"];                                       // 칸에 붙일 클래스를 모은다
    if (weekday === 0) classes.push("sun");                        // 일요일은 빨간 글자다
    if (weekday === 6) classes.push("sat");                        // 토요일은 파란 글자다
    if (info?.holiday) classes.push("holiday");                    // 공휴일은 배경까지 빨갛게 한다
    if (isThisMonth && today.getDate() === day) classes.push("today"); // 오늘은 테두리로 표시한다

    // 공휴일 이름은 날짜 아래에 짧게 보여준다
    const nameHtml = info?.holiday
      ? `<span class="day-name">${escapeHtml(info.names[0])}</span>`
      : "";

    // 기념일·절기·잡절이 있으면 작은 점을 찍는다
    const dotsHtml = info
      ? `<span class="dots">${DOT_KEYS.filter((k) => info.kinds.has(k))
          .map((k) => `<span class="dot ${k.slice(0, -1)}"></span>`).join("")}</span>`
      : "";

    cells.push(`<div class="${classes.join(" ")}">${day}${nameHtml}${dotsHtml}</div>`);
  }

  daysEl.innerHTML = cells.join("");                               // 만든 칸들을 한 번에 넣는다
  calendarEl.hidden = false;                                       // 달력 영역을 보이게 한다
}

// 공휴일·기념일·절기·잡절 목록을 그린다
function renderLists(data) {
  listsEl.innerHTML = SECTIONS.map(({ key, title }) => {           // 네 가지 종류를 모두 돌면서
    const items = data[key] || [];                                 // 그 종류의 항목을 가져온다

    // 자료가 없으면 없다고 알려준다
    const bodyHtml = items.length === 0
      ? '<p class="empty-text">해당하는 날이 없습니다.</p>'
      : items.map((item) => {
          const time = formatTime(item.time);                      // 절기 시각이 있으면 다듬는다
          const timeHtml = time ? ` <span class="date">${time}</span>` : ""; // 시각을 덧붙인다
          return `<div class="list-row">
                    <span class="name">${escapeHtml(item.name)}</span>
                    <span class="date">${item.day}일${timeHtml}</span>
                  </div>`;
        }).join("");

    return `<section class="list-card ${key}">
              <h2 class="list-title">${title} ${items.length}건</h2>
              ${bodyHtml}
            </section>`;
  }).join("");
}

// 그 달에 실제로 쉬는 날 수를 계산해 요약 카드에 표시한다
function renderSummary(year, month, data) {
  // 공휴일 날짜를 중복 없이 모은다 (설날처럼 같은 이름이 여러 날 걸쳐 있어도 날짜 기준으로 센다)
  const holidayDays = new Set((data.holidays || []).filter((h) => h.isHoliday).map((h) => h.day));

  const lastDay = new Date(year, month, 0).getDate();              // 그 달의 마지막 날짜를 구한다
  const weekendDays = new Set();                                   // 주말 날짜를 담을 집합이다

  for (let day = 1; day <= lastDay; day += 1) {                    // 하루씩 돌면서
    const weekday = new Date(year, month - 1, day).getDay();       // 요일을 구한다
    if (weekday === 0 || weekday === 6) weekendDays.add(day);      // 토요일과 일요일을 담는다
  }

  // 공휴일과 주말을 합쳐 실제로 쉬는 날을 중복 없이 센다
  const restDays = new Set([...holidayDays, ...weekendDays]);

  summaryLabel.textContent = "쉬는 날";                             // 설명 글이다
  summaryValue.textContent = restDays.size;                        // 쉬는 날 수를 큰 숫자로 보여준다
  summarySub.textContent =
    `일 (공휴일 ${holidayDays.size}일 + 주말 ${weekendDays.size}일, 겹치는 날 제외)`; // 계산 근거를 밝힌다
}

/* ===== 달 이동 ===== */

// 연·월이 API 범위 안에 있는지 확인한다
function isInRange(year) {
  return year >= MIN_YEAR && year <= MAX_YEAR;                     // 범위를 벗어나면 거짓이다
}

// 화살표 버튼을 범위 끝에서 누를 수 없게 만든다
function updateArrows() {
  const prev = shiftMonth(state.year, state.month, -1);            // 이전 달을 계산한다
  const next = shiftMonth(state.year, state.month, 1);             // 다음 달을 계산한다
  prevBtn.disabled = !isInRange(prev.year);                        // 범위를 벗어나면 비활성화한다
  nextBtn.disabled = !isInRange(next.year);                        // 범위를 벗어나면 비활성화한다
}

// 연·월에 몇 달을 더하거나 빼서 넘어간 결과를 돌려준다 (12월 다음은 다음 해 1월이다)
function shiftMonth(year, month, delta) {
  const zeroBased = (year * 12) + (month - 1) + delta;             // 연·월을 하나의 숫자로 환산해 더한다
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12) + 1 }; // 다시 연과 월로 되돌린다
}

// 미끄러지는 애니메이션을 다시 시작시킨다
function playSlide(direction) {
  stage.style.transform = "";                                      // 손가락으로 밀어둔 위치를 되돌린다
  stage.style.opacity = "";                                        // 손가락으로 흐려둔 투명도를 되돌린다
  stage.classList.remove("in-next", "in-prev", "dragging");        // 이전 애니메이션 표시를 지운다
  void stage.offsetWidth;                                          // 브라우저가 변화를 인식하도록 강제로 값을 읽는다
  stage.classList.add(direction > 0 ? "in-next" : "in-prev");      // 진행 방향에 맞는 애니메이션을 건다
}

// 달을 delta 만큼 옮기고 화면을 갱신한다
function go(delta) {
  const target = shiftMonth(state.year, state.month, delta);       // 옮겨갈 연·월을 계산한다
  if (!isInRange(target.year)) return;                             // 범위를 벗어나면 아무것도 하지 않는다
  state.year = target.year;                                        // 현재 상태를 갱신한다
  state.month = target.month;                                      // 현재 상태를 갱신한다
  render(delta);                                                   // 방향을 알려주며 화면을 다시 그린다
}

/* ===== 전체 흐름 ===== */

// 현재 상태의 연·월 자료를 불러와 요약·달력·목록을 모두 갱신한다
async function render(direction = 0) {
  const { year, month } = state;                                   // 지금 보려는 연·월이다
  const myRequest = requestId += 1;                                // 이번 요청의 번호를 기록한다

  monthLabel.textContent = `${year}년 ${month}월`;                  // 이동 막대의 글자를 먼저 바꿔 반응을 빠르게 한다
  updateArrows();                                                   // 화살표 사용 가능 여부를 갱신한다
  if (direction !== 0) playSlide(direction);                        // 화살표나 밀기로 옮겼으면 미끄러지게 한다

  const cached = cache.has(`${year}-${month}`);                     // 이미 받아둔 달인지 확인한다
  if (!cached) showStatus(`${year}년 ${month}월 정보를 불러오는 중입니다...`); // 처음 보는 달에만 로딩을 알린다

  try {
    const data = await fetchHolidayData(year, month);               // 서버에서 자료를 받아온다
    if (myRequest !== requestId) return;                            // 그 사이 달이 또 바뀌었으면 이 응답은 버린다

    renderSummary(year, month, data);                               // 쉬는 날 수를 계산해 보여준다
    renderCalendar(year, month, buildDayMap(data));                 // 달력을 그린다
    renderLists(data);                                              // 종류별 목록을 그린다
    hideStatus();                                                    // 안내 문구를 감춘다
  } catch (error) {
    if (myRequest !== requestId) return;                            // 오래된 요청의 오류는 무시한다
    showStatus(`정보를 불러오지 못했습니다. (${error.message})`, true); // 오류 내용을 화면에 보여준다
    console.error(error);                                           // 개발자 도구에 자세한 오류를 남긴다
  }
}

/* ===== 조작 연결 ===== */

// 이전 달 화살표를 누르면 한 달 뒤로 간다
prevBtn.addEventListener("click", () => go(-1));
// 다음 달 화살표를 누르면 한 달 앞으로 간다
nextBtn.addEventListener("click", () => go(1));

// 오늘 버튼을 누르면 오늘이 있는 달로 되돌아간다
todayBtn.addEventListener("click", () => {
  const now = new Date();                                           // 오늘 날짜를 가져온다
  const delta = (now.getFullYear() * 12 + now.getMonth())
              - (state.year * 12 + state.month - 1);                // 지금 보는 달과 몇 달 차이인지 구한다
  if (delta === 0) return;                                          // 이미 이번 달이면 아무것도 하지 않는다
  state.year = now.getFullYear();                                   // 현재 상태를 올해로 바꾼다
  state.month = now.getMonth() + 1;                                 // 현재 상태를 이번 달로 바꾼다
  render(delta > 0 ? 1 : -1);                                       // 이동 방향에 맞춰 미끄러지게 한다
});

// 키보드 좌우 화살표로도 달을 넘길 수 있게 한다
document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") go(-1);                            // 왼쪽 화살표는 이전 달이다
  if (event.key === "ArrowRight") go(1);                            // 오른쪽 화살표는 다음 달이다
});

// 손가락으로 미는 동작을 처리하기 위해 시작 위치를 기억해둔다
let touchStartX = 0;
let touchStartY = 0;
let isDragging = false;

// 화면에 손가락이 닿으면 시작 위치를 기록한다
stage.addEventListener("touchstart", (event) => {
  touchStartX = event.touches[0].clientX;                           // 가로 시작 위치다
  touchStartY = event.touches[0].clientY;                           // 세로 시작 위치다
  isDragging = true;                                                // 미는 중이라고 표시한다
  stage.classList.add("dragging");                                  // 애니메이션을 잠시 끈다
}, { passive: true });

// 손가락을 움직이는 동안 화면이 따라오게 한다
stage.addEventListener("touchmove", (event) => {
  if (!isDragging) return;                                          // 미는 중이 아니면 넘어간다
  const dx = event.touches[0].clientX - touchStartX;                // 가로로 움직인 거리다
  const dy = event.touches[0].clientY - touchStartY;                // 세로로 움직인 거리다

  if (Math.abs(dy) > Math.abs(dx)) {                                // 세로로 더 많이 움직였으면
    isDragging = false;                                             // 세로 스크롤로 보고 밀기를 취소한다
    stage.style.transform = "";                                     // 따라온 위치를 되돌린다
    stage.style.opacity = "";                                       // 투명도를 되돌린다
    stage.classList.remove("dragging");                             // 표시를 지운다
    return;
  }

  stage.style.transform = `translateX(${dx * 0.4}px)`;              // 손가락을 따라 조금만 움직인다
  stage.style.opacity = String(Math.max(0.5, 1 - Math.abs(dx) / 400)); // 많이 밀수록 살짝 흐려진다
}, { passive: true });

// 손가락을 떼면 충분히 밀었는지 보고 달을 넘기거나 제자리로 돌린다
stage.addEventListener("touchend", (event) => {
  if (!isDragging) return;                                          // 미는 중이 아니었으면 넘어간다
  isDragging = false;                                               // 미는 상태를 끝낸다
  stage.classList.remove("dragging");                               // 표시를 지운다

  const dx = event.changedTouches[0].clientX - touchStartX;         // 최종으로 움직인 거리다

  if (Math.abs(dx) >= SWIPE_THRESHOLD) {                            // 기준보다 많이 밀었으면
    go(dx < 0 ? 1 : -1);                                            // 왼쪽으로 밀면 다음 달, 오른쪽이면 이전 달이다
  } else {
    stage.style.transform = "";                                     // 덜 밀었으면 제자리로 돌린다
    stage.style.opacity = "";                                       // 투명도도 되돌린다
  }
}, { passive: true });

// 페이지가 처음 열릴 때 이번 달을 보여준다
render();
