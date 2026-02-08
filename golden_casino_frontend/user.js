      // 환전 내역 카드 생성 함수
      function createExchangeHistoryCard(exchange) {
        const card = document.createElement("div");
        card.className =
          "bg-black bg-opacity-50 p-4 rounded-lg border border-[#b8860b] shadow-lg";

        const statusClass = {
          pending: "text-yellow-500 font-bold",
          approved: "text-green-500 font-bold",
          rejected: "text-red-500 font-bold",
        }[exchange.status];

        const statusText = {
          pending: "대기중",
          approved: "승인됨",
          rejected: "거절됨",
        }[exchange.status];

        card.innerHTML = `
          <div class="flex justify-between items-center mb-3">
            <span class="text-sm text-gray-400">${new Date(
              exchange.createdAt
            ).toLocaleString()}</span>
            <span class="${statusClass} px-3 py-1 rounded-full bg-black bg-opacity-50 border border-[#b8860b]">
              ${statusText}
            </span>
          </div>
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="bg-black bg-opacity-30 p-2 rounded-lg">
              신청 금액: <span class="text-yellow-500 font-bold">${
                exchange.requestAmount
              }코인</span>
            </div>
            <div class="bg-black bg-opacity-30 p-2 rounded-lg">
              수수료: <span class="text-red-400 font-bold">${
                exchange.fee
              }코인</span>
            </div>
            <div class="bg-black bg-opacity-30 p-2 rounded-lg">
              실수령액: <span class="text-yellow-500 font-bold">${
                exchange.actualAmount
              }코인</span>
            </div>
            <div class="bg-black bg-opacity-30 p-2 rounded-lg">
              롤링 포인트: <span class="text-blue-400 font-bold">${(
                exchange.rollingPoint || 0
              ).toLocaleString()}코인</span>
            </div>
          </div>
        `;
        return card;
      }

      window.addEventListener("DOMContentLoaded", async () => {
        const token = localStorage.getItem("token");

        // 토큰 유효성 검사 함수
        async function validateToken() {
          if (!token) {
            console.log("토큰이 없습니다. 로그인 페이지로 이동합니다.");
            window.location.href = "index.html";
            return false;
          }

          try {
            // 간단한 API 호출로 토큰 유효성 검사
            const res = await fetch(
              "http://127.0.0.1:5000/api/auth/user-info",
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );

            if (res.status === 401 || res.status === 403) {
              console.log(
                "토큰이 만료되었거나 유효하지 않습니다. 로그인 페이지로 이동합니다."
              );
              localStorage.removeItem("token");
              window.location.href = "index.html";
              return false;
            }

            return true;
          } catch (err) {
            console.error("토큰 검증 중 오류:", err);
            // 네트워크 오류는 토큰 문제가 아닐 수 있으므로 계속 진행
            return true;
          }
        }

        // 토큰 검증 후 계속 진행
        const isValidToken = await validateToken();
        if (!isValidToken) {
          return; // 토큰이 유효하지 않으면 함수 종료
        }

        let socket = io(
          "http://127.0.0.1:5000"
        );

        // 소켓 연결 후 인증
        socket.on("connect", () => {
          socket.emit("authenticate", token);
        });

        let selectedChoice = null;
        let selectedChipAmount = 0;
        let bettingActive = false;
        let lastBetChoice = null; // 마지막 베팅 정보 저장
        let lastBetAmount = 0;
        let miniGame = null; // Phaser 게임 인스턴스 변수
        let baccaratSceneMini = null; // Phaser Scene 인스턴스 변수
        let isBettingInProgress = false; // 베팅 처리 중 플래그
        let currentBets = {}; // 현재 베팅 상황 추적

        // 채팅 관련 변수들
        let isChatOpen = false;
        let unreadChatCount = 0;
        let isHighlightMode = false;

        // DOM 요소 가져오기
        const chargeExchangeModal = document.getElementById(
          "chargeExchangeModal"
        );
        const historyModal = document.getElementById("historyModal");
        const myInfoModal = document.getElementById("myInfoModal");
        const winMessage = document.getElementById("winMessage");

        const showChargeExchangeButton =
          document.getElementById("showChargeExchange");
        const closeChargeExchangeButton = document.getElementById(
          "closeChargeExchange"
        );
        const showHistoryButton = document.getElementById("showHistory");
        const closeHistoryButton = document.getElementById("closeHistory");
        const showMyInfoButton = document.getElementById("showMyInfo");
        const closeMyInfoButton = document.getElementById("closeMyInfo");

        // 탭 관련 요소들
        const chargeTab = document.getElementById("chargeTab");
        const exchangeTab = document.getElementById("exchangeTab");
        const historyTab = document.getElementById("historyTab");
        const transferTab = document.getElementById("transferTab");
        const chargeContent = document.getElementById("chargeContent");
        const exchangeContent = document.getElementById("exchangeContent");
        const historyContent = document.getElementById("historyContent");
        const transferContent = document.getElementById("transferContent");

        const exchangeAmountInput = document.getElementById("exchangeAmount");
        const modalCoinBalance = document.getElementById("modalCoinBalance");
        const modalCoinBalance2 = document.getElementById("modalCoinBalance2");
        const rollingInfoDiv = document.getElementById("rollingInfo");
        const exchangePreview = document.getElementById("exchangePreview");
        const requestAmountSpan = document.getElementById("requestAmount");
        const feeAmountSpan = document.getElementById("feeAmount");
        const actualAmountSpan = document.getElementById("actualAmount");
        const maxAmountButton = document.getElementById("maxAmount");
        const submitExchangeButton = document.getElementById("submitExchange");

        // 환전 신청 완료 모달 관련 요소들
        const exchangeRequestModal = document.getElementById(
          "exchangeRequestModal"
        );
        const closeExchangeRequestModal = document.getElementById(
          "closeExchangeRequestModal"
        );
        const modalRequestAmount =
          document.getElementById("modalRequestAmount");
        const modalDeductedAmount = document.getElementById(
          "modalDeductedAmount"
        );
        const modalCurrentBalance = document.getElementById(
          "modalCurrentBalance"
        );

        // 채팅 관련 DOM 요소들
        const chatFloatingButton =
          document.getElementById("chatFloatingButton");
        const chatWindow = document.getElementById("chatWindow");
        const chatOverlay = document.getElementById("chatOverlay");
        const closeChatButton = document.getElementById("closeChatButton");
        const chatMessages = document.getElementById("chatMessages");
        const chatMessageInput = document.getElementById("chatMessageInput");
        const sendChatButton = document.getElementById("sendChatButton");
        const highlightChatButton = document.getElementById(
          "highlightChatButton"
        );
        const chatCharCount = document.getElementById("chatCharCount");
        const chatNotificationBadge = document.getElementById(
          "chatNotificationBadge"
        );
        const chatNotificationCount = document.getElementById(
          "chatNotificationCount"
        );
        const highlightModeIndicator = document.getElementById(
          "highlightModeIndicator"
        );
        const adminMessageBar = document.getElementById("adminMessageBar");
        const adminMessageBarContainer = document.getElementById(
          "adminMessageBarContainer"
        );
        const adminMessageBarIcon = document.getElementById(
          "adminMessageBarIcon"
        );
        const adminMessageBarSender = document.getElementById(
          "adminMessageBarSender"
        );
        const adminMessageBarTime = document.getElementById(
          "adminMessageBarTime"
        );
        const adminMessageBarContent = document.getElementById(
          "adminMessageBarContent"
        );
        const closeAdminMessageBar = document.getElementById(
          "closeAdminMessageBar"
        );

        // 탭 전환 기능
        function switchTab(activeTab) {
          // 모든 탭 버튼 초기화
          [chargeTab, exchangeTab, historyTab, transferTab].forEach((tab) => {
            if (tab) {
              tab.className =
                "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors text-gray-400 hover:text-yellow-500";
            }
          });

          // 모든 탭 컨텐츠 숨기기
          [
            chargeContent,
            exchangeContent,
            historyContent,
            transferContent,
          ].forEach((content) => {
            if (content) content.classList.add("hidden");
          });

          // 활성 탭 설정
          if (activeTab === "charge") {
            if (chargeTab)
              chargeTab.className =
                "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors golden-btn";
            if (chargeContent) chargeContent.classList.remove("hidden");
          } else if (activeTab === "exchange") {
            if (exchangeTab)
              exchangeTab.className =
                "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors golden-btn";
            if (exchangeContent) exchangeContent.classList.remove("hidden");
          } else if (activeTab === "history") {
            if (historyTab)
              historyTab.className =
                "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors golden-btn";
            if (historyContent) historyContent.classList.remove("hidden");
            // 환전 내역 로드
            fetchExchangeHistory();
          } else if (activeTab === "transfer") {
            if (transferTab)
              transferTab.className =
                "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors golden-btn";
            if (transferContent) transferContent.classList.remove("hidden");
            // 사용자 목록 로드
            fetchUsersList();
            // 현재 활성화된 뽀찌 내부 탭에 따라 데이터 로드
            if (
              !document
                .getElementById("sendMoneySection")
                .classList.contains("hidden")
            ) {
              // 송금하기 탭이 활성화되어 있으면 아무것도 안함 (이미 사용자 목록 로드됨)
            } else if (
              !document
                .getElementById("requestMoneySection")
                .classList.contains("hidden")
            ) {
              // 요청하기 탭이 활성화되어 있으면 아무것도 안함 (이미 사용자 목록 로드됨)
            } else if (
              !document
                .getElementById("transferHistorySection")
                .classList.contains("hidden")
            ) {
              // 내역보기 탭이 활성화되어 있으면 받은 요청과 송금 내역 로드
              fetchReceivedRequests();
              fetchTransferHistory();
            } else {
              // 기본적으로 송금하기 탭 활성화
              switchTransferMode("send");
            }
          }
        }

        // 탭 클릭 이벤트
        if (chargeTab)
          chargeTab.addEventListener("click", () => switchTab("charge"));
        if (exchangeTab)
          exchangeTab.addEventListener("click", () => switchTab("exchange"));
        if (historyTab)
          historyTab.addEventListener("click", () => switchTab("history"));
        if (transferTab)
          transferTab.addEventListener("click", () => switchTab("transfer"));

        // ===========================
        // 채팅 관련 함수들
        // ===========================

        // 채팅창 열기/닫기
        function toggleChat() {
          if (isChatOpen) {
            closeChatWindow();
          } else {
            openChatWindow();
          }
        }

        function openChatWindow() {
          if (chatWindow && chatOverlay && chatFloatingButton) {
            chatOverlay.classList.remove("hidden");
            chatWindow.classList.remove("hidden");
            chatFloatingButton.style.opacity = "0.5";
            isChatOpen = true;

            // 읽지 않은 메시지 카운트 초기화
            unreadChatCount = 0;
            updateChatNotificationBadge();

            // 스크롤을 맨 아래로
            if (chatMessages) {
              setTimeout(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
              }, 100);
            }

            // 채팅 기록 로드
            loadChatHistory();
          }
        }

        function closeChatWindow() {
          if (chatWindow && chatOverlay && chatFloatingButton) {
            chatOverlay.classList.add("hidden");
            chatWindow.classList.add("hidden");
            chatFloatingButton.style.opacity = "1";
            isChatOpen = false;
          }
        }

        // 채팅 기록 로드
        async function loadChatHistory() {
          try {
            const res = await fetch(
              "http://127.0.0.1:5000/api/chat/messages",
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );

            if (res.ok) {
              const messages = await res.json();
              displayChatMessages(messages);
            }
          } catch (err) {
            console.error("채팅 기록 로드 오류:", err);
          }
        }

        // 채팅 메시지들 표시
        function displayChatMessages(messages) {
          if (!chatMessages) return;

          chatMessages.innerHTML = "";
          messages.forEach((message) => {
            appendChatMessage(message);
          });

          // 스크롤을 맨 아래로
          setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
          }, 100);
        }

        // 채팅 메시지 추가
        function appendChatMessage(message) {
          if (!chatMessages) return;

          const messageEl = document.createElement("div");
          messageEl.className = `chat-message ${
            message.isAdmin ? "admin-message" : "user-message"
          } ${message.isHighlighted ? "highlight-message" : ""}`;

          const timeStr = new Date(message.createdAt).toLocaleTimeString(
            "ko-KR",
            {
              hour: "2-digit",
              minute: "2-digit",
            }
          );

          const adminBadge = message.isAdmin
            ? '<span class="inline-block px-2 py-1 bg-yellow-500 text-black text-xs font-bold rounded-full mr-2">관리자</span>'
            : "";
          const highlightBadge = "";

          let bgClass = "bg-black bg-opacity-30 rounded-lg p-3";
          if (message.isAdmin) {
            bgClass =
              "bg-yellow-500 bg-opacity-10 border border-yellow-500 rounded-lg p-3";
          } else if (message.isHighlighted) {
            bgClass =
              "bg-black bg-opacity-30 border border-orange-400 rounded-lg p-3";
          }

          const messageText = message.isHighlighted
            ? ` ${message.message}`
            : message.message;

          messageEl.innerHTML = `
            <div class="flex flex-col ${bgClass}">
              <div class="flex items-center justify-between mb-1">
                <div class="flex items-center">
                  ${adminBadge}
                  ${highlightBadge}
                  <span class="font-bold ${
                    message.isAdmin
                      ? "text-yellow-500"
                      : message.isHighlighted
                      ? "text-orange-300"
                      : "text-white"
                  } text-sm">${message.username}</span>
                </div>
                <span class="text-gray-400 text-xs">${timeStr}</span>
              </div>
              <p class="text-white text-sm break-words">${escapeHtml(
                messageText
              )}</p>
            </div>
          `;

          chatMessages.appendChild(messageEl);
        }

        // HTML 이스케이프 함수
        function escapeHtml(text) {
          const div = document.createElement("div");
          div.textContent = text;
          return div.innerHTML;
        }

        // 채팅 메시지 전송
        async function sendChatMessage() {
          const message = chatMessageInput?.value.trim();
          if (!message || message.length > 500) return;

          try {
            if (isHighlightMode) {
              // 강조 모드일 때 강조 메시지 전송
              socket.emit("send_highlight_message", { message });
              // 강조 모드 자동 해제
              toggleHighlightMode();
            } else {
              // 일반 메시지 전송
              socket.emit("send_chat_message", { message });
            }

            // 입력창 초기화
            if (chatMessageInput) {
              chatMessageInput.value = "";
              updateCharCount();
            }
          } catch (err) {
            console.error("채팅 전송 오류:", err);
            showNotification("채팅 전송에 실패했습니다.");
          }
        }

        // 강조 모드 토글
        function toggleHighlightMode() {
          isHighlightMode = !isHighlightMode;

          if (isHighlightMode) {
            // 강조 모드 활성화
            highlightChatButton.className =
              "px-3 py-2 bg-gradient-to-r from-[#ff6b35] to-[#ff8c42] text-white rounded-lg hover:from-[#ff8c42] hover:to-[#ffa726] transition-all duration-300 font-bold text-sm";
            highlightModeIndicator.classList.remove("hidden");
            chatMessageInput.placeholder = "강조 메시지를 입력하세요...";
            chatMessageInput.classList.add("border-orange-400");
            chatMessageInput.classList.remove("border-[#b8860b]");
          } else {
            // 강조 모드 비활성화
            highlightChatButton.className =
              "px-3 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition-all duration-300 font-bold text-sm";
            highlightModeIndicator.classList.add("hidden");
            chatMessageInput.placeholder = "메시지를 입력하세요...";
            chatMessageInput.classList.remove("border-orange-400");
            chatMessageInput.classList.add("border-[#b8860b]");
          }
        }

        // 문자 수 업데이트
        function updateCharCount() {
          if (chatMessageInput && chatCharCount) {
            const count = chatMessageInput.value.length;
            chatCharCount.textContent = count;

            if (count > 450) {
              chatCharCount.style.color = "#ef4444"; // 빨간색
            } else if (count > 350) {
              chatCharCount.style.color = "#f59e0b"; // 주황색
            } else {
              chatCharCount.style.color = "#6b7280"; // 회색
            }
          }
        }

        // 채팅 알림 뱃지 업데이트
        function updateChatNotificationBadge() {
          if (chatNotificationBadge && chatNotificationCount) {
            if (unreadChatCount > 0 && !isChatOpen) {
              chatNotificationBadge.classList.remove("hidden");
              chatNotificationCount.textContent =
                unreadChatCount > 99 ? "99+" : unreadChatCount;
            } else {
              chatNotificationBadge.classList.add("hidden");
            }
          }
        }

        // 소리 알림 (간단한 알림음)
        function playNotificationSound() {
          try {
            // 간단한 알림음 효과
            const audioContext = new (window.AudioContext ||
              window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(
              600,
              audioContext.currentTime + 0.1
            );

            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(
              0.01,
              audioContext.currentTime + 0.2
            );

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.2);
          } catch (err) {
            // 오디오 재생 실패 시 무시
          }
        }

        // 메시지 알림 바 표시 (관리자 & 강조 메시지 공용)
        function showMessageBar(message, isHighlight = false) {
          if (
            adminMessageBar &&
            adminMessageBarContent &&
            adminMessageBarTime &&
            adminMessageBarSender &&
            adminMessageBarContainer &&
            adminMessageBarIcon
          ) {
            // 메시지 내용 설정
            adminMessageBarContent.textContent = message.message;
            adminMessageBarTime.textContent = new Date(
              message.createdAt
            ).toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
            });

            if (isHighlight) {
              // 강조 메시지 스타일 (관리자 메시지와 동일한 투명 배경)
              adminMessageBarSender.textContent = message.username;
              adminMessageBarSender.className =
                "text-orange-400 font-bold text-sm";
              adminMessageBarContainer.className =
                "bg-black bg-opacity-30 mx-4 rounded-lg backdrop-blur-md border border-orange-400";
              adminMessageBarIcon.className =
                "w-5 h-5 text-orange-400 animate-pulse";
              adminMessageBarIcon.innerHTML =
                '<path fill-rule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0112.12 15.12z" clip-rule="evenodd"></path>';

              // 강조 메시지는 2초 후 숨기기
              setTimeout(() => {
                hideMessageBar();
              }, 2000);
            } else {
              // 관리자 메시지 스타일
              adminMessageBarSender.textContent = "관리자";
              adminMessageBarSender.className =
                "text-yellow-400 font-bold text-sm";
              adminMessageBarContainer.className =
                "bg-black bg-opacity-30 mx-4 rounded-lg backdrop-blur-md border border-white border-opacity-20";
              adminMessageBarIcon.className = "w-5 h-5 text-yellow-400";
              adminMessageBarIcon.innerHTML =
                '<path fill-rule="evenodd" d="M18 3a1 1 0 00-1.447-.894L8.763 6H5a3 3 0 000 6h.28l1.771 5.316A1 1 0 008 18h1a1 1 0 001-1v-4.382l6.553 3.276A1 1 0 0018 15V3z" clip-rule="evenodd"></path>';

              // 관리자 메시지는 3초 후 숨기기
              setTimeout(() => {
                hideMessageBar();
              }, 3000);
            }

            // hidden 클래스 제거하고 슬라이드 다운 애니메이션으로 표시
            adminMessageBar.classList.remove("hidden");
            adminMessageBar.classList.remove("-translate-y-full");
            adminMessageBar.classList.add("translate-y-0");
          }
        }

        // 메시지 알림 바 숨기기
        function hideMessageBar() {
          if (adminMessageBar) {
            adminMessageBar.classList.remove("translate-y-0");
            adminMessageBar.classList.add("-translate-y-full");

            // 완전히 숨기기 위해 hidden 클래스도 추가
            setTimeout(() => {
              adminMessageBar.classList.add("hidden");

              // 스타일을 기본 관리자 스타일로 초기화
              if (
                adminMessageBarContainer &&
                adminMessageBarSender &&
                adminMessageBarIcon &&
                adminMessageBarContent
              ) {
                adminMessageBarContainer.className =
                  "bg-black bg-opacity-30 mx-4 rounded-lg backdrop-blur-md border border-white border-opacity-20";
                adminMessageBarSender.className =
                  "text-yellow-400 font-bold text-sm";
                adminMessageBarSender.textContent = "관리자";
                adminMessageBarIcon.className = "w-5 h-5 text-yellow-400";
                adminMessageBarIcon.innerHTML =
                  '<path fill-rule="evenodd" d="M18 3a1 1 0 00-1.447-.894L8.763 6H5a3 3 0 000 6h.28l1.771 5.316A1 1 0 008 18h1a1 1 0 001-1v-4.382l6.553 3.276A1 1 0 0018 15V3z" clip-rule="evenodd"></path>';
                adminMessageBarContent.textContent = ""; // 내용도 초기화
                adminMessageBarTime.textContent = ""; // 시간도 초기화
              }
            }, 500); // 애니메이션 완료 후 초기화
          }
        }

        // 채팅 이벤트 리스너들
        if (chatFloatingButton) {
          chatFloatingButton.addEventListener("click", toggleChat);
        }

        if (closeChatButton) {
          closeChatButton.addEventListener("click", closeChatWindow);
        }

        if (chatOverlay) {
          chatOverlay.addEventListener("click", closeChatWindow);
        }

        if (sendChatButton) {
          sendChatButton.addEventListener("click", sendChatMessage);
        }

        if (highlightChatButton) {
          highlightChatButton.addEventListener("click", toggleHighlightMode);
        }

        if (chatMessageInput) {
          chatMessageInput.addEventListener("input", updateCharCount);
          chatMessageInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendChatMessage();
            }
          });
        }

        if (closeAdminMessageBar) {
          closeAdminMessageBar.addEventListener("click", () => {
            hideMessageBar();
          });
        }

        // 초기 문자 수 설정
        updateCharCount();

        // 페이지 로드 시 관리자 메시지 바 숨기기 (초기 상태)
        hideMessageBar();

        // 뽀찌 관련 변수 및 함수들
        let selectedUserId = null;
        let selectedSendUserId = null; // 송금용 선택된 사용자
        // 요청 기능 제거됨
        let transferMode = "send"; // 'send' or 'request'

        // 뽀찌 내부 탭 전환
        function switchTransferMode(mode) {
          const sendMoneyBtn = document.getElementById("sendMoneyBtn");
          const transferHistoryBtn =
            document.getElementById("transferHistoryBtn");
          const sendMoneySection = document.getElementById("sendMoneySection");
          const transferHistorySection = document.getElementById(
            "transferHistorySection"
          );

          // 폼 숨기기
          document.getElementById("sendMoneyForm")?.classList.add("hidden");

          // 모든 버튼 초기화
          [sendMoneyBtn, transferHistoryBtn].forEach((btn) => {
            if (btn)
              btn.className =
                "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors text-gray-400 hover:text-yellow-500";
          });

          // 모든 섹션 숨기기
          [sendMoneySection, transferHistorySection].forEach((section) => {
            if (section) section.classList.add("hidden");
          });

          // 활성화
          if (mode === "send") {
            if (sendMoneyBtn)
              sendMoneyBtn.className =
                "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors golden-btn";
            if (sendMoneySection) sendMoneySection.classList.remove("hidden");
            transferMode = "send";
          } else if (mode === "history") {
            if (transferHistoryBtn)
              transferHistoryBtn.className =
                "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors golden-btn";
            if (transferHistorySection)
              transferHistorySection.classList.remove("hidden");
          }
        }

        // 뽀찌 내부 탭 이벤트 리스너
        document
          .getElementById("sendMoneyBtn")
          ?.addEventListener("click", () => switchTransferMode("send"));
        document
          .getElementById("transferHistoryBtn")
          ?.addEventListener("click", () => switchTransferMode("history"));

        // 사용자 목록 가져오기
        async function fetchUsersList() {
          try {
            const res = await fetch(
              "http://127.0.0.1:5000/api/users/list",
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            if (res.ok) {
              const users = await res.json();
              displayUsersList(users, "send");

              // 잔액 업데이트
              const balanceEl = document.getElementById("transferBalance");
              const userRes = await fetch(
                "http://127.0.0.1:5000/api/auth/user-info",
                {
                  headers: { Authorization: `Bearer ${token}` },
                }
              );
              if (userRes.ok) {
                const userData = await userRes.json();
                if (balanceEl)
                  balanceEl.textContent = `${userData.balance.toLocaleString()}코인`;
              }
            } else {
              showNotification("사용자 목록을 가져오는 데 실패했습니다.");
            }
          } catch (err) {
            // 사용자 목록 조회 에러
            showNotification("서버 연결 오류가 발생했습니다.");
          }
        }

        // 사용자 목록 표시
        function displayUsersList(users, mode) {
          const listEl = document.getElementById("usersList");
          if (!listEl) return;

          listEl.innerHTML = "";
          users.forEach((user) => {
            const userEl = document.createElement("div");
            userEl.className =
              "flex justify-between items-center p-2 hover:bg-black hover:bg-opacity-30 rounded cursor-pointer transition-colors";
            userEl.innerHTML = `
              <span class="text-white">${user.username}</span>
              <button class="text-yellow-500 hover:text-yellow-400 text-sm" data-user-id="${user._id}" data-username="${user.username}">
                송금
              </button>
            `;
            userEl.querySelector("button").addEventListener("click", (e) => {
              const userId = e.target.getAttribute("data-user-id");
              const username = e.target.getAttribute("data-username");
              selectUser(userId, username, mode);
            });
            listEl.appendChild(userEl);
          });
        }

        // 사용자 선택
        function selectUser(userId, username, mode) {
          selectedSendUserId = userId;
          selectedUserId = userId;
          document.getElementById("selectedUserName").textContent = username;
          document.getElementById("sendMoneyForm").classList.remove("hidden");
        }

        // 사용자 검색
        document
          .getElementById("userSearchInput")
          ?.addEventListener("input", (e) => {
            const searchTerm = e.target.value.toLowerCase();
            filterUsers(searchTerm, "send");
          });

        // 요청 검색 기능 제거됨

        function filterUsers(searchTerm, mode) {
          const listEl = document.getElementById("usersList");
          if (!listEl) return;

          const userElements = listEl.querySelectorAll("div");
          userElements.forEach((el) => {
            const username = el.querySelector("span").textContent.toLowerCase();
            if (username.includes(searchTerm)) {
              el.style.display = "flex";
            } else {
              el.style.display = "none";
            }
          });
        }

        // 송금 금액 입력 및 미리보기
        document
          .getElementById("sendAmount")
          ?.addEventListener("input", (e) => {
            const amount = parseInt(e.target.value);
            const previewEl = document.getElementById("sendPreview");
            const confirmBtn = document.getElementById("confirmSendButton");

            if (isNaN(amount) || amount < 1) {
              previewEl.classList.add("hidden");
              confirmBtn.disabled = true;
              return;
            }

            const fee = 0; // 0% 수수료
            const total = amount + fee;

            document.getElementById(
              "sendAmountPreview"
            ).textContent = `${amount.toLocaleString()}코인`;
            document.getElementById(
              "sendFeePreview"
            ).textContent = `${fee.toLocaleString()}코인`;
            document.getElementById(
              "sendTotalPreview"
            ).textContent = `${total.toLocaleString()}코인`;
            previewEl.classList.remove("hidden");

            // 잔액 확인
            const balanceText = document
              .getElementById("transferBalance")
              .textContent.replace(/[^0-9]/g, "");
            const balance = parseInt(balanceText) || 0;

            confirmBtn.disabled = total > balance;
          });

        // 송금 요청
        document
          .getElementById("confirmSendButton")
          ?.addEventListener("click", async () => {
            const amount = parseInt(
              document.getElementById("sendAmount").value
            );
            if (!selectedSendUserId || !amount || amount < 1) {
              showNotification("올바른 송금 정보를 입력해주세요.");
              return;
            }

            const confirmBtn = document.getElementById("confirmSendButton");
            confirmBtn.disabled = true;
            confirmBtn.textContent = "처리중...";

            try {
              const response = await fetch(
                "http://127.0.0.1:5000/api/transfer/send",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    toUserId: selectedSendUserId,
                    amount: amount,
                  }),
                }
              );

              const data = await response.json();
              if (response.ok) {
                // 송금 성공 시 폼 초기화
                document.getElementById("sendAmount").value = "";
                document
                  .getElementById("sendMoneyForm")
                  .classList.add("hidden");
                document.getElementById("sendPreview").classList.add("hidden");
                selectedSendUserId = null;
                selectedUserId = null; // 호환성을 위해 유지

                // 잔액 업데이트
                fetchUserInfo();

                // 송금 내역이 보이고 있다면 새로고침
                if (
                  !document
                    .getElementById("transferHistorySection")
                    .classList.contains("hidden")
                ) {
                  fetchTransferHistory();
                }
              } else {
                showNotification(data.message || "송금에 실패했습니다.");
              }
            } catch (error) {
              // 송금 에러
              showNotification("서버 연결 오류가 발생했습니다.");
            } finally {
              confirmBtn.disabled = false;
              confirmBtn.textContent = "송금하기";
            }
          });

        // 요청 금액 입력 검증
        document
          .getElementById("requestAmount")
          ?.addEventListener("input", (e) => {
            console.log("요청 금액 입력 이벤트 발생!");

            const inputValue = e.target.value ? e.target.value.trim() : "";
            const amount = inputValue ? parseInt(inputValue) : 0;
            const confirmBtn = document.getElementById("confirmRequestButton");

            console.log("현재 상태:", {
              inputValue,
              amount,
              selectedRequestUserId,
              buttonElement: confirmBtn,
            });

            // 금액만 체크하고, 사용자 선택은 버튼 클릭 시에 확인
            const shouldDisable = !inputValue || isNaN(amount) || amount < 1000;
            console.log("버튼 상태 결정:", { shouldDisable });

            if (confirmBtn) {
              confirmBtn.disabled = shouldDisable;
              console.log("버튼 disabled 설정:", shouldDisable);

              // 사용자가 선택되지 않았을 때 안내 메시지 표시
              if (!shouldDisable && !selectedRequestUserId) {
                confirmBtn.textContent = "사용자를 먼저 선택하세요";
                console.log("버튼 텍스트 변경: 사용자를 먼저 선택하세요");
              } else if (!shouldDisable) {
                confirmBtn.textContent = "요청하기";
                console.log("버튼 텍스트 변경: 요청하기");
              }
            } else {
              console.error("confirmRequestButton 요소를 찾을 수 없습니다!");
            }
          });

        // 머니 요청
        document
          .getElementById("confirmRequestButton")
          ?.addEventListener("click", async () => {
            console.log("요청하기 버튼 클릭됨!");
            const amount = parseInt(
              document.getElementById("requestAmount").value
            );
            const message = document.getElementById("requestMessage").value;

            if (!selectedRequestUserId || !amount || amount < 1000) {
              showNotification("올바른 요청 정보를 입력해주세요.");
              return;
            }

            const confirmBtn = document.getElementById("confirmRequestButton");
            confirmBtn.disabled = true;
            confirmBtn.textContent = "처리중...";

            try {
              const response = await fetch(
                "http://127.0.0.1:5000/api/transfer/request",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    fromUserId: selectedRequestUserId,
                    amount: amount,
                    message: message,
                  }),
                }
              );

              const data = await response.json();
              if (response.ok) {
                showNotification("머니 요청이 전송되었습니다.");
                // 요청 성공 시 폼 초기화
                document.getElementById("requestAmount").value = "";
                document.getElementById("requestMessage").value = "";
                document
                  .getElementById("requestMoneyForm")
                  .classList.add("hidden");
                selectedRequestUserId = null;
                selectedUserId = null; // 호환성을 위해 유지
                // 버튼 상태 초기화
                confirmBtn.disabled = true;
              } else {
                showNotification(data.message || "요청 전송에 실패했습니다.");
              }
            } catch (error) {
              // 요청 전송 에러
              showNotification("서버 연결 오류가 발생했습니다.");
            } finally {
              confirmBtn.disabled = false;
              confirmBtn.textContent = "요청하기";
            }
          });

        // 요청 관련 기능 모두 제거됨

        // 송금 내역 가져오기
        async function fetchTransferHistory() {
          try {
            const res = await fetch(
              "http://127.0.0.1:5000/api/transfer/history",
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            if (res.ok) {
              const history = await res.json();
              displayTransferHistory(history);
            }
          } catch (err) {
            // 송금 내역 조회 에러
          }
        }

        // 송금 내역 표시
        function displayTransferHistory(history) {
          const listEl = document.getElementById("transferHistoryList");
          if (!listEl) return;

          listEl.innerHTML = "";
          if (history.length === 0) {
            listEl.innerHTML =
              '<div class="text-center text-gray-400 py-2">송금 내역이 없습니다.</div>';
            return;
          }

          history.forEach((transfer) => {
            const transEl = document.createElement("div");
            transEl.className =
              "bg-black bg-opacity-50 p-3 rounded-lg border border-[#b8860b]";
            const isSent = transfer.type === "sent";
            transEl.innerHTML = `
              <div class="flex justify-between items-center">
                <div>
                  <div class="text-sm ${
                    isSent ? "text-red-400" : "text-green-400"
                  }">
                    ${isSent ? "송금" : "수신"}
                  </div>
                  <div class="text-white font-bold">
                    ${
                      isSent
                        ? transfer.toUser.username
                        : transfer.fromUser.username
                    }
                  </div>
                  <div class="text-xs text-gray-400">${new Date(
                    transfer.createdAt
                  ).toLocaleString()}</div>
                </div>
                <div class="text-right">
                  <div class="text-lg font-bold ${
                    isSent ? "text-red-400" : "text-green-400"
                  }">
                    ${isSent ? "-" : "+"}${transfer.amount.toLocaleString()}코인
                  </div>
                  ${
                    transfer.fee > 0
                      ? `<div class="text-xs text-gray-400">수수료 ${transfer.fee.toLocaleString()}코인</div>`
                      : ""
                  }
                </div>
              </div>
            `;
            listEl.appendChild(transEl);
          });
        }

        // 충전 신청 관련 이벤트 리스너 추가
        const depositAmountInput = document.getElementById("depositAmount");
        const submitDepositButton = document.getElementById("submitDeposit");

        // 충전 금액 버튼 클릭 이벤트
        document.querySelectorAll(".deposit-amount-btn").forEach((button) => {
          button.addEventListener("click", function () {
            const amount = parseInt(this.getAttribute("data-deposit-amount"));
            if (depositAmountInput) {
              depositAmountInput.value = amount;
            }
          });
        });

        // 충전 신청 버튼 클릭 이벤트
        if (submitDepositButton) {
          submitDepositButton.addEventListener("click", async () => {
            const amount = parseInt(depositAmountInput?.value || "0");

            if (!amount || isNaN(amount) || amount < 5) {
              showNotification("충전 금액은 최소 5코인 이상이어야 합니다.");
              return;
            }

            submitDepositButton.disabled = true;
            submitDepositButton.textContent = "처리중...";

            try {
              const response = await fetch(
                "http://127.0.0.1:5000/api/deposit/request",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ amount }),
                }
              );

              const data = await response.json();

              if (response.ok) {
                showNotification(
                  "충전 신청이 완료되었습니다. 관리자 승인을 기다려주세요."
                );
                if (depositAmountInput) depositAmountInput.value = "";
                chargeExchangeModal.classList.add("hidden");
                // 충전 내역 새로고침 (있다면)
                // await fetchDepositHistory();
              } else {
                showNotification(data.message || "충전 신청에 실패했습니다.");
              }
            } catch (error) {
              // 충전 신청 에러
              showNotification("서버 연결 오류가 발생했습니다.");
            } finally {
              submitDepositButton.disabled = false;
              submitDepositButton.textContent = "충전 신청하기";
            }
          });
        }

        // 알림 표시 함수
        function showNotification(message, duration = 3000) {
          const notification = document.getElementById("notification");
          const notificationMessage = document.getElementById(
            "notificationMessage"
          );
          if (!notification || !notificationMessage) return;
          notificationMessage.textContent = message;
          notification.classList.remove("hidden");
          setTimeout(() => {
            notification.classList.add("hidden");
          }, duration);
        }

        // 환전 신청 완료 모달 표시 함수
        function showExchangeRequestModal(requestAmount, newBalance) {
          if (modalRequestAmount)
            modalRequestAmount.textContent = `${requestAmount.toLocaleString()}코인`;
          if (modalDeductedAmount)
            modalDeductedAmount.textContent = `${requestAmount.toLocaleString()}코인`;
          if (modalCurrentBalance)
            modalCurrentBalance.textContent = `${newBalance.toLocaleString()}코인`;
          if (exchangeRequestModal)
            exchangeRequestModal.classList.remove("hidden");
        }

        // 환전 완료 모달 닫기 이벤트
        if (closeExchangeRequestModal) {
          closeExchangeRequestModal.addEventListener("click", () => {
            if (exchangeRequestModal)
              exchangeRequestModal.classList.add("hidden");
          });
        }

        // 환전 완료 모달 외부 클릭 시 닫기
        if (exchangeRequestModal) {
          exchangeRequestModal.addEventListener("click", (e) => {
            if (e.target === exchangeRequestModal) {
              exchangeRequestModal.classList.add("hidden");
            }
          });
        }

        // 승리 모달 표시 함수

        // fetchUserInfo 디바운싱을 위한 변수
        let fetchUserInfoTimer = null;
        let fetchUserInfoInProgress = false;

        // 사용자 정보 가져오기 (디바운싱 적용)
        async function fetchUserInfo(immediate = false) {
          // 즉시 실행이 아닌 경우 디바운싱 적용
          if (!immediate) {
            if (fetchUserInfoTimer) {
              clearTimeout(fetchUserInfoTimer);
            }
            fetchUserInfoTimer = setTimeout(() => {
              fetchUserInfo(true);
            }, 200); // 200ms 디바운싱
            return;
          }

          // 이미 요청 중이면 중복 요청 방지
          if (fetchUserInfoInProgress) {
            return;
          }

          fetchUserInfoInProgress = true;

          try {
            const res = await fetch(
              "http://127.0.0.1:5000/api/auth/user-info",
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            if (res.ok) {
              const user = await res.json();
              const coinBalanceEl = document.getElementById("coinBalance");

              const balance =
                typeof user.balance === "number" && !isNaN(user.balance)
                  ? user.balance
                  : 0;
              const totalBets =
                typeof user.totalBets === "number" && !isNaN(user.totalBets)
                  ? user.totalBets
                  : 0;
              const rollingDeposit =
                typeof user.rollingDeposit === "number"
                  ? user.rollingDeposit
                  : 0;
              const rollingWagered =
                typeof user.rollingWagered === "number"
                  ? user.rollingWagered
                  : 0;
              const maxExchangeAmount =
                typeof user.maxExchangeAmount === "number"
                  ? user.maxExchangeAmount
                  : 0;

              if (coinBalanceEl)
                coinBalanceEl.innerText = `잔액: ${balance.toLocaleString()}코인`;

              // 환전 모달에도 잔액 업데이트
              if (modalCoinBalance) {
                modalCoinBalance.textContent = `${balance.toLocaleString()}코인`;
              }
              if (modalCoinBalance2) {
                modalCoinBalance2.textContent = `${balance.toLocaleString()}코인`;
              }
              // 환전 모달 롤링 정보 업데이트
              if (rollingInfoDiv) {
                const rollingRequirement = rollingDeposit * 1.0;
                const progress =
                  rollingRequirement > 0
                    ? (rollingWagered / rollingRequirement) * 100
                    : 100;

                const progressTextEl = document.getElementById(
                  "rollingProgressText"
                );
                const progressBarEl =
                  document.getElementById("rollingProgressBar");
                const wageredTextEl =
                  document.getElementById("rollingWageredText");
                const requirementTextEl = document.getElementById(
                  "rollingRequirementText"
                );

                // 실제 달성률 표시 (100% 초과도 표시)
                if (progressTextEl)
                  progressTextEl.textContent = `${progress.toFixed(1)}%`;
                // 프로그레스 바는 최대 100%까지만
                if (progressBarEl)
                  progressBarEl.style.width = `${Math.min(100, progress)}%`;
                if (wageredTextEl)
                  wageredTextEl.textContent = `${rollingWagered.toLocaleString()}코인`;
                if (requirementTextEl)
                  requirementTextEl.textContent = `${rollingRequirement.toLocaleString()}코인`;

                // 환전 가능 금액 표시 추가
                const maxExchangeEl =
                  document.getElementById("maxExchangeAmount");
                if (maxExchangeEl)
                  maxExchangeEl.textContent = `${maxExchangeAmount.toLocaleString()}코인`;

                // 환전 버튼 활성화/비활성화 로직
                const amountInputVal = parseInt(exchangeAmountInput.value);
                const isAmountValid =
                  !isNaN(amountInputVal) &&
                  amountInputVal >= 10 &&
                  amountInputVal <= maxExchangeAmount &&
                  maxExchangeAmount > 0;

                if (isAmountValid) {
                  submitExchangeButton.disabled = false;
                } else {
                  submitExchangeButton.disabled = true;
                }

                // 롤링 미달성 시 안내 메시지 표시
                if (
                  maxExchangeAmount === 0 &&
                  rollingRequirement > rollingWagered
                ) {
                  const remainingRolling = rollingRequirement - rollingWagered;
                  const maxExchangeEl =
                    document.getElementById("maxExchangeAmount");
                  if (maxExchangeEl)
                    maxExchangeEl.innerHTML = `0코인 <span class="text-red-400 text-sm">(${remainingRolling.toLocaleString()}코인 더 베팅 필요)</span>`;
                }
              }

              displayBettingHistory(user.bettingHistory);
              updateMyInfoModal(user);
            } else {
              showNotification("사용자 정보를 가져오는 데 실패했습니다.");
            }
          } catch (err) {
            // 에러
            showNotification("서버 연결 오류가 발생했습니다.");
          } finally {
            fetchUserInfoInProgress = false;
          }
        }

        // 내 정보 모달 탭 전환 기능
        function switchMyInfoTab(activeTab) {
          // 모든 탭 버튼 초기화
          const tabs = ["overviewTab", "bettingTab", "financialTab"];
          const contents = [
            "overviewContent",
            "bettingContent",
            "financialContent",
          ];

          tabs.forEach((tabId) => {
            const tab = document.getElementById(tabId);
            if (tab) {
              tab.className =
                "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors text-gray-400 hover:text-yellow-500";
            }
          });

          contents.forEach((contentId) => {
            const content = document.getElementById(contentId);
            if (content) content.classList.add("hidden");
          });

          // 활성 탭 설정
          const activeTabElement = document.getElementById(activeTab + "Tab");
          const activeContentElement = document.getElementById(
            activeTab + "Content"
          );

          if (activeTabElement) {
            activeTabElement.className =
              "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors golden-btn";
          }
          if (activeContentElement) {
            activeContentElement.classList.remove("hidden");
          }
        }

        // 상세 사용자 정보 가져오기 함수
        async function fetchDetailedUserInfo() {
          try {
            // 상세 사용자 정보 요청 시작
            const res = await fetch(
              "http://127.0.0.1:5000/api/user/detailed-info",
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            if (res.ok) {
              const data = await res.json();
              // 상세 사용자 정보 응답 및 베팅 통계
              updateDetailedMyInfoModal(data);
            } else {
              // API 응답 오류
              showNotification("상세 정보를 가져오는 데 실패했습니다.");
            }
          } catch (err) {
            console.error("상세 정보 조회 에러:", err);
            showNotification("서버 연결 오류가 발생했습니다.");
          }
        }

        // 상세 내 정보 모달 업데이트 함수
        function updateDetailedMyInfoModal(data) {
          // 계정 정보
          const userInfoName = document.getElementById("userInfoName");
          const userInfoJoinDate = document.getElementById("userInfoJoinDate");
          const userInfoLastLogin =
            document.getElementById("userInfoLastLogin");
          const userInfoStatus = document.getElementById("userInfoStatus");

          if (userInfoName) userInfoName.textContent = data.username || "-";
          if (userInfoJoinDate) {
            const joinDate = data.createdAt
              ? new Date(data.createdAt).toLocaleDateString()
              : "-";
            userInfoJoinDate.textContent = joinDate;
          }
          if (userInfoLastLogin) {
            const lastLogin = data.lastLogin
              ? new Date(data.lastLogin).toLocaleString()
              : "현재 접속중";
            userInfoLastLogin.textContent = lastLogin;
          }
          if (userInfoStatus) {
            userInfoStatus.textContent = data.isApproved ? "승인됨" : "미승인";
            userInfoStatus.className = data.isApproved
              ? "text-green-400 font-semibold"
              : "text-red-400 font-semibold";
          }

          // 게임 통계
          const userWins = document.getElementById("userWins");
          const userLoses = document.getElementById("userLoses");
          const userWinRateEl = document.getElementById("userWinRate");
          const totalGamesEl = document.getElementById("totalGames");
          const gameStatsBettingProfit = document.getElementById(
            "gameStatsBettingProfit"
          );

          if (userWins) userWins.textContent = data.gameStats.wins;
          if (userLoses) userLoses.textContent = data.gameStats.losses;
          if (userWinRateEl)
            userWinRateEl.textContent = `${data.gameStats.winRate}%`;
          if (totalGamesEl)
            totalGamesEl.textContent = data.gameStats.totalGames;

          // 게임 통계에 베팅 손익 표시
          if (gameStatsBettingProfit) {
            const profit = data.bettingStats.bettingProfit;
            gameStatsBettingProfit.textContent = `${profit.toLocaleString()}코인`;
            gameStatsBettingProfit.className =
              profit >= 0
                ? "font-bold text-lg text-green-400"
                : "font-bold text-lg text-red-400";
          }

          // 전체 손익
          const currentBalance = document.getElementById("currentBalance");
          const overallProfit = document.getElementById("overallProfit");

          if (currentBalance)
            currentBalance.textContent = `${data.balance.toLocaleString()}코인`;
          if (overallProfit) {
            const profit = data.financialInfo.overallProfit;
            overallProfit.textContent = `${profit.toLocaleString()}코인`;
            overallProfit.className =
              profit >= 0
                ? "font-bold text-lg text-green-400"
                : "font-bold text-lg text-red-400";
          }

          // 베팅 통계
          const totalBetAmount = document.getElementById("modalTotalBetAmount");
          const totalWinAmount = document.getElementById("modalTotalWinAmount");
          const bettingProfit = document.getElementById("modalBettingProfit");
          const averageBetAmount = document.getElementById(
            "modalAverageBetAmount"
          );

          if (totalBetAmount) {
            totalBetAmount.textContent = `${data.bettingStats.totalBetAmount.toLocaleString()}코인`;
          } else {
            console.error("modalTotalBetAmount 요소를 찾을 수 없음");
          }
          if (totalWinAmount)
            totalWinAmount.textContent = `${data.bettingStats.totalWinAmount.toLocaleString()}코인`;
          if (bettingProfit) {
            const profit = data.bettingStats.bettingProfit;
            bettingProfit.textContent = `${profit.toLocaleString()}코인`;
            bettingProfit.className =
              profit >= 0
                ? "font-bold text-green-400"
                : "font-bold text-red-400";
          }
          if (averageBetAmount)
            averageBetAmount.textContent = `${data.bettingStats.averageBetAmount.toLocaleString()}코인`;

          // 베팅 선호도
          updateChoicePreferences(
            data.choiceStats,
            data.gameStats.favoriteChoice
          );

          // 롤링 정보
          const rollingProgressTextInfo = document.getElementById(
            "rollingProgressTextInfo"
          );
          const rollingProgressBarInfo = document.getElementById(
            "rollingProgressBarInfo"
          );
          const rollingWageredAmount = document.getElementById(
            "rollingWageredAmount"
          );
          const rollingRequiredAmount = document.getElementById(
            "rollingRequiredAmount"
          );
          const rollingStatusText =
            document.getElementById("rollingStatusText");

          if (rollingProgressTextInfo)
            rollingProgressTextInfo.textContent = `${data.rollingInfo.rollingProgress}%`;
          if (rollingProgressBarInfo)
            rollingProgressBarInfo.style.width = `${data.rollingInfo.rollingProgress}%`;
          if (rollingWageredAmount)
            rollingWageredAmount.textContent = `${data.rollingInfo.rollingWagered.toLocaleString()}코인`;
          if (rollingRequiredAmount)
            rollingRequiredAmount.textContent = `${data.rollingInfo.rollingRequirement.toLocaleString()}코인`;

          // 롤링 상태 텍스트 업데이트
          if (rollingStatusText) {
            const isRollingComplete =
              data.rollingInfo.rollingWagered >=
              data.rollingInfo.rollingRequirement;
            if (isRollingComplete) {
              rollingStatusText.textContent =
                "✅ 롤링 달성 완료 - 전액 환전 가능";
              rollingStatusText.className =
                "text-xs text-green-400 mt-1 font-bold";
            } else {
              const remaining =
                data.rollingInfo.rollingRequirement -
                data.rollingInfo.rollingWagered;
              rollingStatusText.textContent = `❌ 롤링 미달성 - ${remaining.toLocaleString()}코인 더 베팅 필요`;
              rollingStatusText.className = "text-xs text-red-400 mt-1";
            }
          }

          // 재정 정보
          const totalDeposited = document.getElementById("totalDeposited");
          const totalExchanged = document.getElementById("totalExchanged");
          const depositCount = document.getElementById("depositCount");
          const exchangeCount = document.getElementById("exchangeCount");

          if (totalDeposited)
            totalDeposited.textContent = `${data.financialInfo.totalDeposited.toLocaleString()}코인`;
          if (totalExchanged)
            totalExchanged.textContent = `${data.financialInfo.totalExchanged.toLocaleString()}코인`;
          if (depositCount)
            depositCount.textContent = data.financialInfo.depositCount;
          if (exchangeCount)
            exchangeCount.textContent = data.financialInfo.exchangeCount;

          // 최근 기록들
          updateRecentRecords(null, data.recentDeposits, data.recentExchanges);
        }

        // 베팅 선호도 차트 업데이트
        function updateChoicePreferences(choiceStats, favoriteChoice) {
          const choicePreferences =
            document.getElementById("choicePreferences");
          const favoriteChoiceEl = document.getElementById("favoriteChoice");

          if (!choicePreferences) return;

          const choiceNames = {
            player: "플레이어",
            banker: "뱅커",
            tie: "타이",
            player_pair: "P 페어",
            banker_pair: "B 페어",
          };

          const colors = {
            player: "bg-blue-500",
            banker: "bg-red-500",
            tie: "bg-green-500",
            player_pair: "bg-purple-500",
            banker_pair: "bg-orange-500",
          };

          const total = Object.values(choiceStats).reduce(
            (sum, count) => sum + count,
            0
          );

          choicePreferences.innerHTML = "";

          if (total === 0) {
            choicePreferences.innerHTML =
              '<div class="text-center text-gray-400 py-2">베팅 기록이 없습니다.</div>';
            if (favoriteChoiceEl) favoriteChoiceEl.textContent = "-";
            return;
          }

          Object.entries(choiceStats).forEach(([choice, count]) => {
            if (count > 0) {
              const percentage = ((count / total) * 100).toFixed(1);
              const div = document.createElement("div");
              div.className = "flex items-center justify-between";
              div.innerHTML = `
                <div class="flex items-center gap-2">
                  <div class="w-3 h-3 rounded ${colors[choice]}"></div>
                  <span class="text-sm">${choiceNames[choice]}</span>
                </div>
                <div class="text-sm">
                  <span class="text-gray-400">${count}회</span>
                  <span class="text-yellow-500 ml-1">(${percentage}%)</span>
                </div>
              `;
              choicePreferences.appendChild(div);
            }
          });

          if (favoriteChoiceEl && favoriteChoice) {
            favoriteChoiceEl.textContent = `${
              choiceNames[favoriteChoice.choice]
            } (${favoriteChoice.count}회)`;
          }
        }

        // 최근 기록들 업데이트
        function updateRecentRecords(
          recentBets,
          recentDeposits,
          recentExchanges
        ) {
          // 최근 충전 내역
          const recentDepositsEl = document.getElementById("recentDeposits");
          if (recentDepositsEl) {
            recentDepositsEl.innerHTML = "";

            if (recentDeposits.length === 0) {
              recentDepositsEl.innerHTML =
                '<div class="text-center text-gray-400 py-2">최근 충전 내역이 없습니다.</div>';
            } else {
              recentDeposits.forEach((deposit) => {
                const div = document.createElement("div");
                div.className = "bg-black bg-opacity-30 p-3 rounded-lg";

                const statusClass = {
                  pending: "text-yellow-500",
                  approved: "text-green-500",
                  rejected: "text-red-500",
                }[deposit.status];

                const statusText = {
                  pending: "대기중",
                  approved: "승인됨",
                  rejected: "거절됨",
                }[deposit.status];

                div.innerHTML = `
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-xs text-gray-400">${new Date(
                      deposit.createdAt
                    ).toLocaleString()}</span>
                    <span class="${statusClass} font-bold text-sm">${statusText}</span>
                  </div>
                  <div class="text-center">
                    <span class="text-blue-400 font-bold">${deposit.amount.toLocaleString()}코인</span>
                  </div>
                `;
                recentDepositsEl.appendChild(div);
              });
            }
          }

          // 최근 환전 내역
          const recentExchangesEl = document.getElementById("recentExchanges");
          if (recentExchangesEl) {
            recentExchangesEl.innerHTML = "";

            if (recentExchanges.length === 0) {
              recentExchangesEl.innerHTML =
                '<div class="text-center text-gray-400 py-2">최근 환전 내역이 없습니다.</div>';
            } else {
              recentExchanges.forEach((exchange) => {
                const div = document.createElement("div");
                div.className = "bg-black bg-opacity-30 p-3 rounded-lg";

                const statusClass = {
                  pending: "text-yellow-500",
                  approved: "text-green-500",
                  rejected: "text-red-500",
                }[exchange.status];

                const statusText = {
                  pending: "대기중",
                  approved: "승인됨",
                  rejected: "거절됨",
                }[exchange.status];

                div.innerHTML = `
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-xs text-gray-400">${new Date(
                      exchange.createdAt
                    ).toLocaleString()}</span>
                    <span class="${statusClass} font-bold text-sm">${statusText}</span>
                  </div>
                  <div class="text-center">
                    <span class="text-orange-400 font-bold">${(
                      exchange.actualAmount || exchange.requestAmount
                    ).toLocaleString()}코인</span>
                  </div>
                `;
                recentExchangesEl.appendChild(div);
              });
            }
          }
        }

        // 기존 내 정보 모달 업데이트 함수 (호환성 유지)
        function updateMyInfoModal(user) {
          // 기본 정보만 업데이트 (상세 정보는 fetchDetailedUserInfo에서 처리)
          const userWins = document.getElementById("userWins");
          const userLoses = document.getElementById("userLoses");
          const userWinRateEl = document.getElementById("userWinRate");
          const totalGamesEl = document.getElementById("totalGames");

          const bettingHistory = user.bettingHistory || [];
          const wins = bettingHistory.filter(
            (record) => record.result === "win"
          ).length;
          const loses = bettingHistory.filter(
            (record) => record.result === "lose"
          ).length;
          const totalGames = bettingHistory.length;
          const winRate =
            totalGames > 0 ? ((wins / totalGames) * 100).toFixed(1) : 0;

          if (userWins) userWins.textContent = wins;
          if (userLoses) userLoses.textContent = loses;
          if (userWinRateEl) userWinRateEl.textContent = `${winRate}%`;
          if (totalGamesEl) totalGamesEl.textContent = totalGames;
        }

        // 베팅 기록 표시 함수 수정
        function displayBettingHistory(history) {
          const container = document.getElementById("bettingHistory");
          if (!container) return;
          container.innerHTML = "";
          container.scrollTop = 0;

          if (!history || history.length === 0) {
            container.innerHTML = `<div class="text-center text-gray-400 py-4">베팅 기록이 없습니다.</div>`;
            const winRateEl = document.getElementById("winRate");
            if (winRateEl) winRateEl.textContent = `승률: 0%`;
            return;
          }

          const totalBets = history.length;
          const wins = history.filter(
            (record) => record.result === "win"
          ).length;
          const winRateValue =
            totalBets > 0 ? ((wins / totalBets) * 100).toFixed(1) : 0;
          const winRateEl = document.getElementById("winRate");
          if (winRateEl) winRateEl.textContent = `승률: ${winRateValue}%`;

          history
            .slice()
            .reverse()
            .forEach((record) => {
              const card = document.createElement("div");
              card.className = "betting-history-card";
              const resultClass =
                record.result === "win"
                  ? "text-green-400"
                  : record.result === "lose"
                  ? "text-red-400"
                  : "text-yellow-400";
              const resultText =
                record.result === "win"
                  ? "승리"
                  : record.result === "lose"
                  ? "패배"
                  : "환급";
              const choiceKorean = {
                player: "플레이어",
                banker: "뱅커",
                tie: "타이",
                player_pair: "P 페어",
                banker_pair: "B 페어",
                null: "없음",
              };

              const displayAmount = (
                typeof record.amount === "number" ? record.amount : 0
              ).toLocaleString();
              let displayDate = "날짜 정보 없음";
              if (record.date) {
                try {
                  displayDate = new Date(record.date).toLocaleString();
                } catch (e) {
                  console.error(
                    "Invalid date format in betting history:",
                    record.date,
                    e
                  );
                  displayDate = "잘못된 날짜 형식";
                }
              } else {
                console.warn("Missing date in betting history record:", record);
              }

              card.innerHTML = `
              <div class="flex justify-between items-center mb-1">
                <span class="text-sm text-gray-400">${displayDate}</span>
                <span class="font-bold ${resultClass}">${resultText}</span>
              </div>
              <div class="flex justify-between items-center">
                <span>${
                  choiceKorean[record.choice] || record.choice || "선택 없음"
                } → ${
                choiceKorean[record.gameResult] ||
                record.gameResult ||
                "결과 없음"
              }</span>
                <span class="text-yellow-400 font-bold">${displayAmount} 코인</span>
              </div>`;
              container.appendChild(card);
            });
        }

        // 선택 상태 업데이트 함수 수정
        function updateCurrentBet() {
          const choiceKorean = {
            player: "플레이어",
            banker: "뱅커",
            tie: "타이",
            player_pair: "P 페어",
            banker_pair: "B 페어",
            null: "없음",
          };
          const choiceText = document.querySelector("#currentBet .choice-text");
          const coinsText = document.querySelector("#currentBet .coins-text");

          if (choiceText)
            choiceText.textContent = choiceKorean[selectedChoice] || "없음";
          if (coinsText)
            coinsText.textContent = `${selectedChipAmount.toLocaleString()}코인`;

          document.querySelectorAll(".choice-button").forEach((btn) => {
            if (btn.getAttribute("data-choice") === selectedChoice)
              btn.classList.add("active");
            else btn.classList.remove("active");
          });

          document.querySelectorAll(".amount-button").forEach((btn) => {
            if (
              parseInt(btn.getAttribute("data-amount")) === selectedChipAmount
            ) {
              btn.classList.add("active");
            } else {
              btn.classList.remove("active");
            }
          });
        }

        // 로그아웃 기능
        document.getElementById("logout")?.addEventListener("click", () => {
          if (confirm("정말 로그아웃 하시겠습니까?")) {
            localStorage.removeItem("token");
            showNotification("로그아웃되었습니다.");
            setTimeout(() => {
              window.location.href = "index.html";
            }, 1000);
          }
        });

        // 베팅 종류 버튼 클릭 이벤트 수정: 선택 및 즉시 베팅
        document.querySelectorAll(".choice-button").forEach((button) => {
          button.addEventListener("click", async () => {
            // 베팅 처리 중이면 무시
            if (isBettingInProgress) {
              return;
            }

            if (!bettingActive) {
              showNotification("현재 베팅 시간이 아닙니다.");
              return;
            }

            selectedChoice = button.getAttribute("data-choice");
            if (!selectedChoice) {
              showNotification("베팅 종류를 선택해주세요.");
              return;
            }
            if (selectedChipAmount <= 0) {
              showNotification("베팅할 금액을 먼저 선택해주세요.");
              updateCurrentBet();
              return;
            }

            // 뱅커/플레이어 베팅 제한 체크
            if (selectedChoice === "player" || selectedChoice === "banker") {
              const oppositeChoice =
                selectedChoice === "player" ? "banker" : "player";
              if (
                currentBets[oppositeChoice] &&
                currentBets[oppositeChoice] > 0
              ) {
                showNotification(
                  `${
                    oppositeChoice === "player" ? "플레이어" : "뱅커"
                  }에 이미 베팅하셨습니다. 뱅커와 플레이어 중 한 곳에만 베팅할 수 있습니다.`
                );
                return;
              }
            }

            // 베팅 처리 시작
            isBettingInProgress = true;

            // 베팅 정보 저장
            lastBetChoice = selectedChoice;
            lastBetAmount = selectedChipAmount;

            socket.emit("place_bet", {
              choice: selectedChoice,
              amount: selectedChipAmount,
              token: token,
            });

            updateCurrentBet();
          });
        });

        // 금액 버튼 클릭 이벤트 수정: 단일 칩 금액 선택
        document.querySelectorAll(".amount-button").forEach((button) => {
          button.addEventListener("click", () => {
            const chipValue = parseInt(button.getAttribute("data-amount"));
            if (selectedChipAmount === chipValue) {
              selectedChipAmount = 0;
            } else {
              selectedChipAmount = chipValue;
            }
            updateCurrentBet();
          });
        });

        // 되돌리기 버튼 이벤트 수정: 모든 임시 베팅 취소 요청
        document
          .getElementById("undoBetButton")
          ?.addEventListener("click", () => {
            if (!bettingActive) {
              showNotification("베팅 시간이 아니므로 되돌릴 수 없습니다.");
              return;
            }
            // 서버에 모든 임시 베팅 취소 요청
            socket.emit("cancel_bet", { token: token });
          });

        /**
         * 빅로드 매트릭스를 기반으로 화면에 그리기
         * @param {Array<Array<Object>>} matrix - 빅로드를 나타내는 2차원 배열
         * @param {number} maxCols - 렌더링할 열의 수
         */
        function renderBigRoad(matrix, maxCols) {
          const container = document.getElementById("recentResults");
          if (!container) return;
          container.innerHTML = "";

          const MAX_ROWS = 6;
          for (let c = 0; c < maxCols; c++) {
            let colHasContent = false;
            for (let r = 0; r < MAX_ROWS; r++) {
              if (matrix[r] && matrix[r][c]) {
                colHasContent = true;
                break;
              }
            }

            // 드래곤 테일 확인
            if (!colHasContent && c > 0) {
              for (let tailCol = c; tailCol < maxCols; tailCol++) {
                if (matrix[MAX_ROWS - 1] && matrix[MAX_ROWS - 1][tailCol]) {
                  colHasContent = true;
                  break;
                }
              }
            }

            if (!colHasContent) continue;

            const colEl = document.createElement("div");
            colEl.className = "result-column";

            for (let r = 0; r < MAX_ROWS; r++) {
              const result = matrix[r] ? matrix[r][c] : null;
              const cellEl = document.createElement("div");

              if (result) {
                cellEl.className = `result-cell ${
                  result.winner === "p" || result.winner === "player"
                    ? "player"
                    : "banker"
                }`;
                cellEl.style.position = "relative";

                // 페어 마커 추가
                if (result.pair === "p") {
                  const pairDot = document.createElement("div");
                  pairDot.style.cssText =
                    "position: absolute; width: 6px; height: 6px; background-color: #3b82f6; border-radius: 50%; bottom: 0px; left: 0px;";
                  cellEl.appendChild(pairDot);
                } else if (result.pair === "b") {
                  const pairDot = document.createElement("div");
                  pairDot.style.cssText =
                    "position: absolute; width: 6px; height: 6px; background-color: #ef4444; border-radius: 50%; top: 0px; right: 0px;";
                  cellEl.appendChild(pairDot);
                }

                // 타이 마커 추가
                if (result.tieCount > 0) {
                  const tieSlash = document.createElement("div");
                  tieSlash.style.cssText =
                    "position: absolute; width: 18px; height: 3px; background-color: #10b981; transform: rotate(45deg); top: 50%; left: 50%; margin-left: -9px; margin-top:-1.5px; transform-origin: center; border-radius: 1px;";
                  cellEl.appendChild(tieSlash);
                  if (result.tieCount > 1) {
                    const tieCountText = document.createElement("span");
                    tieCountText.textContent = result.tieCount;
                    tieCountText.style.cssText =
                      "position: absolute; right: 1px; bottom: 0px; font-size: 8px; color: white; line-height:1; text-shadow: 1px 1px 1px black;";
                    cellEl.appendChild(tieCountText);
                  }
                }
              } else {
                cellEl.className = "result-cell";
                cellEl.style.visibility = "hidden";
              }
              colEl.appendChild(cellEl);
            }
            container.appendChild(colEl);
          }
        }

        /**
         * 파생 로드 렌더링 (빅아이, 스몰, 코크로치)
         * @param {string} containerId - 컨테이너 요소의 ID
         * @param {Array<string>} results - 결과 배열 ('player'는 파랑, 'banker'는 빨강)
         * @param {number} maxRows - 이 로드의 최대 행 수
         */
        function renderDerivedRoad(containerId, results, maxRows) {
          const container = document.getElementById(containerId);
          if (!container) return;
          container.innerHTML = "";
          if (!results || results.length === 0) return;

          const MAX_COLS = 100;
          const matrix = Array(maxRows)
            .fill(0)
            .map(() => Array(MAX_COLS).fill(null));
          let col = 0;
          let row = 0;
          let lastResult = null;
          let totalCols = 0;

          results.forEach((result) => {
            if (lastResult && result !== lastResult) {
              col++;
              row = 0;
            }

            let r_coord = row;
            let c_coord = col;

            if (row >= maxRows) {
              // 드래곤 테일
              r_coord = maxRows - 1;
              c_coord = col + (row - (maxRows - 1));
            }

            if (r_coord < maxRows && c_coord < MAX_COLS) {
              if (!matrix[r_coord]) matrix[r_coord] = [];
              matrix[r_coord][c_coord] = result;
              totalCols = Math.max(totalCols, c_coord);
            }

            row++;
            lastResult = result;
          });

          // 매트릭스 렌더링
          for (let c = 0; c <= totalCols; c++) {
            let colHasContent = false;
            for (let r = 0; r < maxRows; r++) {
              if (matrix[r] && matrix[r][c]) {
                colHasContent = true;
                break;
              }
            }
            if (!colHasContent) continue;

            const colEl = document.createElement("div");
            colEl.className = "result-column";

            for (let r = 0; r < maxRows; r++) {
              const result = matrix[r] ? matrix[r][c] : null;
              const cellEl = document.createElement("div");
              cellEl.className = "derived-road-cell";

              if (result) {
                cellEl.classList.add(result);
              } else {
                cellEl.style.visibility = "hidden";
              }
              colEl.appendChild(cellEl);
            }
            container.appendChild(colEl);
          }
        }

        /**
         * 빅로드 히스토리를 기반으로 모든 파생 로드 계산
         * 표준 카지노 규칙을 따름
         * @param {Array<Object>} history - 전체 게임 히스토리
         * @returns {Object} 각 파생 로드의 배열을 포함하는 객체
         */
        function calculateAllDerivedRoads(history) {
          const roads = { bigEye: [], small: [], cockroach: [] };
          const nonTieHistory = history.filter((h) => h.result !== "tie");
          if (nonTieHistory.length < 2) return roads;

          // 빅로드에서 각 비타이 결과의 좌표 결정
          let coords = [];
          let col = 0,
            row = 0,
            lastWinner = null;

          nonTieHistory.forEach((res) => {
            if (lastWinner && res.result !== lastWinner) {
              col++;
              row = 0;
            }
            coords.push({ r: row, c: col });
            lastWinner = res.result;
            row++;
          });

          const getColDepth = (c) => coords.filter((p) => p.c === c).length;
          const cellExists = (r, c) =>
            coords.some((p) => p.r === r && p.c === c);

          // 두 번째 엔트리부터 파생 로드 결과 생성
          for (let i = 1; i < coords.length; i++) {
            const { r, c } = coords[i];

            // 표준 파생 로드 로직 구현
            const getDerivedResult = (offset) => {
              if (c < offset) return null; // 충분한 히스토리가 없음

              if (r === 0) {
                // 새 열의 첫 번째 항목: 열 깊이 비교로 "정돈성" 확인
                if (c < offset + 1) return null; // 비교할 열이 충분하지 않음
                const prevColDepth = getColDepth(c - offset);
                const prevPrevColDepth = getColDepth(c - offset - 1);
                return prevColDepth === prevPrevColDepth ? "banker" : "player"; // banker=빨강=정돈, player=파랑=불규칙
              } else {
                // 드롭다운 항목: 참조 열에서 셀 존재 여부 확인
                // 참조 열의 같은 행에 셀이 있으면 -> 파랑 ("player")
                // 없으면 -> 빨강 ("banker")
                return cellExists(r, c - offset) ? "player" : "banker";
              }
            };

            // 각 로드에 대해 올바른 오프셋으로 계산
            const bigEyeResult = getDerivedResult(1); // col-1과 비교
            if (bigEyeResult) roads.bigEye.push(bigEyeResult);

            const smallResult = getDerivedResult(2); // col-2와 비교
            if (smallResult) roads.small.push(smallResult);

            const cockroachResult = getDerivedResult(3); // col-3과 비교
            if (cockroachResult) roads.cockroach.push(cockroachResult);
          }

          return roads;
        }

        /**
         * 모든 스코어보드를 업데이트하고 렌더링하는 메인 함수
         * @param {Array<Object>} history - 서버에서 받은 전체 게임 히스토리
         */
        function updateScoreboard(history) {
          if (!history) return;

          // 1. 히스토리에서 빅로드 매트릭스 구축
          const MAX_ROWS = 6;
          const MAX_COLS = 150;
          const bigRoadMatrix = Array(MAX_ROWS)
            .fill(0)
            .map(() => Array(MAX_COLS).fill(null));
          let col = 0,
            row = 0,
            lastWinner = null;
          let totalCols = 0;

          history.forEach((result) => {
            const {
              result: winner,
              playerPairOccurred,
              bankerPairOccurred,
            } = result;
            if (winner === "tie") {
              // 마지막에 놓인 마커에 타이 카운트 추가
              let lastR, lastC;
              if (row > 0) {
                lastR = row - 1;
                lastC = col;
              } else if (col > 0) {
                lastC = col - 1;
                lastR = -1;
                for (let i = 0; i < MAX_ROWS; i++) {
                  if (bigRoadMatrix[i] && bigRoadMatrix[i][lastC]) lastR = i;
                  else break;
                }
                // 드래곤 테일 확인
                if (lastR === MAX_ROWS - 1) {
                  let tail_c = lastC + 1;
                  while (bigRoadMatrix[lastR] && bigRoadMatrix[lastR][tail_c]) {
                    lastC = tail_c;
                    tail_c++;
                  }
                }
              }

              if (lastR !== undefined && lastR > -1 && lastC !== undefined) {
                if (bigRoadMatrix[lastR] && bigRoadMatrix[lastR][lastC]) {
                  bigRoadMatrix[lastR][lastC].tieCount =
                    (bigRoadMatrix[lastR][lastC].tieCount || 0) + 1;
                }
              }
            } else {
              // 플레이어 또는 뱅커 승리
              if (lastWinner && winner !== lastWinner) {
                col++;
                row = 0;
              }
              const currentResult = {
                winner: winner.toLowerCase(),
                pair: playerPairOccurred
                  ? "p"
                  : bankerPairOccurred
                  ? "b"
                  : null,
                tieCount: 0,
              };
              lastWinner = winner;

              let r_coord = row,
                c_coord = col;
              if (row >= MAX_ROWS) {
                // 드래곤 테일
                r_coord = MAX_ROWS - 1;
                c_coord = col + (row - (MAX_ROWS - 1));
              }

              if (r_coord < MAX_ROWS && c_coord < MAX_COLS) {
                if (!bigRoadMatrix[r_coord]) bigRoadMatrix[r_coord] = [];
                bigRoadMatrix[r_coord][c_coord] = currentResult;
              }
              totalCols = Math.max(totalCols, c_coord);
              row++;
            }
          });

          // 2. 히스토리 기반 방법으로 파생 로드 계산
          const derivedRoads = calculateAllDerivedRoads(history);

          // 3. 모든 것 렌더링
          renderBigRoad(bigRoadMatrix, totalCols + 15);
          renderDerivedRoad("bigEyeRoad", derivedRoads.bigEye, 6);
          renderDerivedRoad("smallRoad", derivedRoads.small, 3);
          renderDerivedRoad("cockroachRoad", derivedRoads.cockroach, 3);
        }

        // 최근 게임 결과 가져오기 함수 수정 (Big Road 스타일)
        async function fetchRecentGames() {
          try {
            const res = await fetch(
              "http://127.0.0.1:5000/api/recent-games"
            );
            const games = await res.json();

            // 통계 카운트
            let playerCount = 0;
            let bankerCount = 0;
            let tieCount = 0;

            if (games.length === 0) {
              updateGameCounts(0, 0, 0);
              return;
            }

            // 통계 계산
            games.forEach((game) => {
              if (game.result === "player") playerCount++;
              else if (game.result === "banker") bankerCount++;
              else if (game.result === "tie") tieCount++;
            });

            // 통계 업데이트
            updateGameCounts(playerCount, bankerCount, tieCount);

            // 게임 데이터를 오래된 순서로 정렬 (빅로드는 왼쪽부터 시작)
            const sortedGames = [...games].reverse();

            // 고급 빅로드 시스템으로 업데이트
            updateScoreboard(sortedGames);
          } catch (err) {
            console.error("최근 게임 결과 조회 에러:", err);
          }
        }

        // 게임 카운트 업데이트 함수
        function updateGameCounts(playerCount, bankerCount, tieCount) {
          const playerCountEl = document.getElementById("playerCount");
          const bankerCountEl = document.getElementById("bankerCount");
          const tieCountEl = document.getElementById("tieCount");

          if (playerCountEl) playerCountEl.textContent = playerCount;
          if (bankerCountEl) bankerCountEl.textContent = bankerCount;
          if (tieCountEl) tieCountEl.textContent = tieCount;
        }

        // Socket.IO 이벤트 핸들러들
        socket.on("bet_success", (data) => {
          // 베팅 처리 완료
          isBettingInProgress = false;

          // 임시 잔액 표시 (실제 잔액 - 베팅 예정 금액)
          if (data.newBalance !== undefined) {
            const coinBalanceEl = document.getElementById("coinBalance");
            if (coinBalanceEl) {
              coinBalanceEl.textContent = `잔액: ${data.newBalance.toLocaleString()}코인 (임시)`;
            }
            // 모달의 잔액 표시도 업데이트
            const modalCoinBalance =
              document.getElementById("modalCoinBalance");
            const modalCoinBalance2 =
              document.getElementById("modalCoinBalance2");
            if (modalCoinBalance) {
              modalCoinBalance.textContent = `${data.newBalance.toLocaleString()}코인 (임시)`;
            }
            if (modalCoinBalance2) {
              modalCoinBalance2.textContent = `${data.newBalance.toLocaleString()}코인 (임시)`;
            }
          }

          // 성공 메시지 표시 (베팅 추가됨)
          if (data.message) {
            showNotification(data.message, "success");
          }
        });

        socket.on("bet_cancelled_success", (data) => {
          // 원래 잔액으로 복원
          if (data.newBalance !== undefined) {
            const coinBalanceEl = document.getElementById("coinBalance");
            if (coinBalanceEl) {
              coinBalanceEl.textContent = `잔액: ${data.newBalance.toLocaleString()}코인`;
            }
            // 모달의 잔액 표시도 업데이트
            const modalCoinBalance =
              document.getElementById("modalCoinBalance");
            const modalCoinBalance2 =
              document.getElementById("modalCoinBalance2");
            if (modalCoinBalance) {
              modalCoinBalance.textContent = `${data.newBalance.toLocaleString()}코인`;
            }
            if (modalCoinBalance2) {
              modalCoinBalance2.textContent = `${data.newBalance.toLocaleString()}코인`;
            }
          }

          // 베팅 취소 메시지 표시
          if (data.message) {
            showNotification(data.message, "info");
          }

          // 금액 선택은 유지하고 선택 상태만 초기화
          selectedChoice = null;
          // selectedChipAmount는 초기화하지 않음 (유지)
          updateCurrentBet();
        });

        socket.on("error", (message) => {
          // 베팅 처리 완료 (에러 발생)
          isBettingInProgress = false;

          showNotification(message);
        });

        socket.on("betting_started", () => {
          bettingActive = true;
          currentBets = {}; // 새 게임 시작 시 베팅 상황 초기화
          const timerEl = document.getElementById("timer");
          if (timerEl) timerEl.innerText = "베팅이 시작되었습니다.";
          const bettingStartSound =
            document.getElementById("bettingStartSound");
          bettingStartSound?.play().catch((err) => {});

          // 게임 상태 업데이트
          const gameStatusEl = document.getElementById("gameStatus");
          if (gameStatusEl) {
            gameStatusEl.innerText = "베팅 진행중";
            gameStatusEl.className = "text-xl font-bold text-yellow-500 mb-1";
          }

          // 새 베팅 라운드 시작시에만 UI 선택 초기화 (마지막 베팅 정보는 유지)
          selectedChoice = null;
          // selectedChipAmount = 0; // 베팅 금액은 유지
          updateCurrentBet();

          // 잔액 표시에서 (임시) 제거
          fetchUserInfo();
        });

        // 베팅 확정 이벤트 핸들러 추가
        socket.on("bets_confirmed", (data) => {
          showNotification(data.message, "success");

          // 잔액 표시에서 (임시) 제거하고 실제 잔액으로 업데이트
          fetchUserInfo();
        });

        socket.on("betting_end_time", (endTime) => {
          startTimer(new Date(endTime));
        });

        function startTimer(endTime) {
          const timerElement = document.getElementById("timer");
          if (!timerElement) return;

          // 기존 타이머가 있으면 정리
          if (window.bettingTimerInterval) {
            clearInterval(window.bettingTimerInterval);
          }

          window.bettingTimerInterval = setInterval(() => {
            const now = new Date();
            const distance = endTime - now;
            if (distance < 0) {
              clearInterval(window.bettingTimerInterval);
              timerElement.innerText =
                "베팅 시간이 종료되었습니다. 결과를 기다려주세요.";
              timerElement.className = "text-red-500 font-bold";
              selectedChoice = null;
              // selectedChipAmount = 0; // 베팅 금액은 유지
              updateCurrentBet();
              return;
            }
            const seconds = Math.floor((distance / 1000) % 60);
            timerElement.innerText = `베팅 종료까지: ${seconds}초`;
            if (seconds <= 10)
              timerElement.className = "text-red-500 font-bold animate-pulse";
            else
              timerElement.className =
                "text-base font-semibold text-yellow-400";
          }, 1000);
        }

        socket.on("betting_closed", () => {
          bettingActive = false;
          isBettingInProgress = false; // 베팅 진행 중 플래그 초기화

          const timerEl = document.getElementById("timer");
          if (timerEl)
            timerEl.innerText =
              "베팅 시간이 종료되었습니다. 결과를 기다려주세요.";
          const bettingEndSound = document.getElementById("bettingEndSound");
          bettingEndSound?.play().catch((err) => {});
          // selectedChoice와 selectedChipAmount는 게임 결과 처리 후에 초기화
          // selectedChoice = null;
          // selectedChipAmount = 0;
          updateCurrentBet();
        });

        socket.on("game_result", (data) => {
          const {
            result,
            playerScore,
            bankerScore,
            // playerPairOccurred, // 미니게임에서는 페어 직접 표시 안함 (recentResults에서 확인)
            // bankerPairOccurred,
          } = data;
          const gameStatusEl = document.getElementById("gameStatus");
          let statusText = "";
          let soundId = "";

          if (result === "player") {
            statusText = `플레이어 승 (${playerScore}-${bankerScore})`;
            if (gameStatusEl)
              gameStatusEl.className = "text-xl font-bold text-blue-400 mb-2";
            soundId = "playerWinSound";
          } else if (result === "banker") {
            statusText = `뱅커 승 (${playerScore}-${bankerScore})`;
            if (gameStatusEl)
              gameStatusEl.className = "text-xl font-bold text-red-400 mb-2";
            soundId = "bankerWinSound";
          } else {
            statusText = `타이 (${playerScore}-${bankerScore})`;
            if (gameStatusEl)
              gameStatusEl.className = "text-xl font-bold text-green-400 mb-2";
            soundId = "tieSound";
          }
          if (gameStatusEl) gameStatusEl.textContent = statusText;
          document
            .getElementById(soundId)
            ?.play()
            .catch((err) => {});

          // 미니게임에도 결과 표시
          if (baccaratSceneMini && baccaratSceneMini.sys.isActive()) {
            baccaratSceneMini.setGameResult(result, playerScore, bankerScore);
          }

          const timerEl = document.getElementById("timer");
          if (timerEl) {
            timerEl.innerText = "결과 발표 중... (2초 후 초기화)";
            timerEl.className =
              "text-base font-semibold text-yellow-400 bg-black bg-opacity-50 inline-block px-3 py-1 rounded-lg border border-[#b8860b]";

            // 카운트다운 표시
            let countdown = 2;
            const countdownInterval = setInterval(() => {
              countdown--;
              if (countdown > 0) {
                timerEl.innerText = `결과 발표 중... (${countdown}초 후 초기화)`;
              } else {
                clearInterval(countdownInterval);
              }
            }, 1000);
          }
          // 최근 결과 업데이트는 result_approved에서 처리하므로 여기서는 중복 호출 방지
          // fetchRecentGames(); // 이 부분은 result_approved로 이동 또는 거기서만 호출
        });

        socket.on("result_approved", (data) => {
          // 게임 결과를 즉시 초기화
          setTimeout(() => {
            fetchUserInfo();
            fetchRecentGames(); // 결과 승인 후 최근 게임 목록 업데이트

            // 예측 결과 확인 및 제거
            if (currentPrediction) {
              removePrediction();
            }

            const gameStatusEl = document.getElementById("gameStatus");
            if (gameStatusEl) {
              gameStatusEl.textContent = "게임 대기중";
              gameStatusEl.className = "text-lg font-bold text-yellow-500 mb-2";
            }
            const timerEl = document.getElementById("timer");
            if (timerEl) {
              timerEl.textContent = "";
              timerEl.className = "text-base font-semibold text-yellow-400";
            }
            // 베팅 정보 완전 초기화
            // selectedChipAmount = 0; // 베팅 금액은 유지
            selectedChoice = null;
            lastBetChoice = null;
            lastBetAmount = 0;
            isBettingInProgress = false; // 베팅 진행 중 플래그 초기화
            previousStats = {}; // 이전 통계 초기화
            updateCurrentBet();
            updateMyBetAmounts({}); // 내 베팅액 표시 초기화 (총 베팅 금액도 함께 초기화됨)

            // 미니게임 클리어
            if (baccaratSceneMini && baccaratSceneMini.sys.isActive()) {
              baccaratSceneMini.clearAllCardsAndText();
            }

            updateBettingStatsDisplay({
              player: {
                count: 0,
                total: 0,
                bettor_count: 0,
                total_bet_amount: 0,
              },
              banker: {
                count: 0,
                total: 0,
                bettor_count: 0,
                total_bet_amount: 0,
              },
              tie: { count: 0, total: 0, bettor_count: 0, total_bet_amount: 0 },
              player_pair: {
                count: 0,
                total: 0,
                bettor_count: 0,
                total_bet_amount: 0,
              },
              banker_pair: {
                count: 0,
                total: 0,
                bettor_count: 0,
                total_bet_amount: 0,
              },
            });
          }, 200); // 0.2초 후 초기화
        });

        // 중복 업데이트 방지를 위한 디바운싱
        let updateCoinsTimeout = null;
        socket.on("update_coins", () => {
          // 기존 timeout이 있으면 클리어
          if (updateCoinsTimeout) {
            clearTimeout(updateCoinsTimeout);
          }

          // 500ms 후에 사용자 정보 업데이트 (중복 요청 방지)
          updateCoinsTimeout = setTimeout(() => {
            fetchUserInfo();
            updateCoinsTimeout = null;
          }, 500);
        });

        // 관리자 잔액 조정 시 실시간 업데이트
        socket.on("balance_updated", (data) => {
          const coinBalanceEl = document.getElementById("coinBalance");
          if (coinBalanceEl) {
            coinBalanceEl.textContent = `잔액: ${data.newBalance.toLocaleString()}코인`;
          }
          // 환전 모달에도 업데이트
          const modalCoinBalance = document.getElementById("modalCoinBalance");
          const modalCoinBalance2 =
            document.getElementById("modalCoinBalance2");
          if (modalCoinBalance) {
            modalCoinBalance.textContent = `${data.newBalance.toLocaleString()}코인`;
          }
          if (modalCoinBalance2) {
            modalCoinBalance2.textContent = `${data.newBalance.toLocaleString()}코인`;
          }
          showNotification("관리자가 잔액을 조정했습니다.");
        });

        // 충전 요청 처리 알림
        socket.on("deposit_request_processed", (data) => {
          if (data.status === "approved") {
            showNotification(
              `충전이 승인되었습니다! +${data.amount.toLocaleString()}코인`
            );
            // 내 정보 모달이 열려있다면 새로고침
            if (!myInfoModal.classList.contains("hidden")) {
              fetchDetailedUserInfo();
            }
          } else {
            showNotification(
              `충전 요청이 거절되었습니다. (${data.amount.toLocaleString()}코인)`
            );
          }
        });

        // 환전 요청 처리 알림
        socket.on("exchange_request_processed", (data) => {
          if (data.status === "approved") {
            showNotification(
              `환전이 승인되었습니다! 실수령액: ${data.actualAmount.toLocaleString()}코인`
            );
            // 내 정보 모달이 열려있다면 새로고침
            if (!myInfoModal.classList.contains("hidden")) {
              fetchDetailedUserInfo();
            }
          } else {
            showNotification(
              `환전 요청이 거절되었습니다. (신청액: ${data.requestAmount.toLocaleString()}코인)`
            );
          }
        });

        // 송금 받았을 때 알림
        socket.on("money_received", (data) => {
          showNotification(
            `${
              data.fromUsername
            }님으로부터 ${data.amount.toLocaleString()}원을 받았습니다!`
          );
          fetchUserInfo();
        });

        // 송금 보냈을 때 알림
        socket.on("money_sent", (data) => {
          showNotification(
            `${
              data.toUsername
            }님에게 ${data.amount.toLocaleString()}원을 송금했습니다. (수수료: ${data.fee.toLocaleString()}코인)`
          );
        });

        // 승리 알림 수신
        socket.on("you_won", (data) => {
          console.log("승리 알림 받음:", data);

          // 거의 바로 승리 메시지 표시
          setTimeout(() => {
            showWinMessage(data.winnings);
          }, 50);
        });

        // 송금 내역 업데이트 신호
        socket.on("transfer_history_updated", () => {
          // 뽀찌 탭이 열려있고 내역보기가 활성화되어 있다면 새로고침
          if (
            !chargeExchangeModal.classList.contains("hidden") &&
            transferContent &&
            !transferContent.classList.contains("hidden") &&
            !document
              .getElementById("transferHistorySection")
              .classList.contains("hidden")
          ) {
            fetchTransferHistory();
          }
        });

        // 머니 요청 관련 Socket 이벤트 모두 제거됨

        // ===========================
        // 채팅 관련 Socket 이벤트들
        // ===========================

        // 새 채팅 메시지 수신
        socket.on("new_chat_message", (message) => {
          // 채팅창이 열려있으면 메시지 추가
          if (isChatOpen) {
            appendChatMessage(message);
            // 스크롤을 맨 아래로
            setTimeout(() => {
              if (chatMessages) {
                chatMessages.scrollTop = chatMessages.scrollHeight;
              }
            }, 100);
          } else {
            // 채팅창이 닫혀있으면 읽지 않은 메시지 카운트 증가
            unreadChatCount++;
            updateChatNotificationBadge();

            // 일반 메시지는 간단한 알림음만
            if (!message.isAdmin) {
              playNotificationSound();
            }
          }
        });

        // Admin 메시지 특별 알림
        socket.on("admin_message_notification", (data) => {
          const message = data.message;

          // Admin 메시지 알림 바 표시
          showMessageBar(message, false);

          // 특별한 알림음 (더 강한 소리)
          try {
            const audioContext = new (window.AudioContext ||
              window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            // Admin 메시지는 더 긴 알림음
            oscillator.frequency.setValueAtTime(1000, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(
              1200,
              audioContext.currentTime + 0.1
            );
            oscillator.frequency.setValueAtTime(
              800,
              audioContext.currentTime + 0.2
            );

            gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(
              0.01,
              audioContext.currentTime + 0.5
            );

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
          } catch (err) {
            // 오디오 재생 실패 시 무시
          }

          // 채팅창이 닫혀있어도 Admin 메시지는 바로 추가
          if (!isChatOpen && chatMessages) {
            appendChatMessage(message);
          }
        });

        // 강조 메시지 특별 알림
        socket.on("highlight_message_notification", (data) => {
          const message = data.message;

          // 강조 메시지 알림 바 표시 (2초간)
          showMessageBar(message, true);

          // 강조 메시지 알림음
          try {
            const audioContext = new (window.AudioContext ||
              window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            // 강조 메시지는 특별한 알림음
            oscillator.frequency.setValueAtTime(900, audioContext.currentTime);
            oscillator.frequency.setValueAtTime(
              1100,
              audioContext.currentTime + 0.1
            );
            oscillator.frequency.setValueAtTime(
              900,
              audioContext.currentTime + 0.2
            );

            gainNode.gain.setValueAtTime(0.12, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(
              0.01,
              audioContext.currentTime + 0.3
            );

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
          } catch (err) {
            // 오디오 재생 실패 시 무시
          }

          // 채팅창이 닫혀있어도 강조 메시지는 바로 추가 (관리자 메시지와 동일)
          if (!isChatOpen && chatMessages) {
            const highlightMessage = {
              ...message,
              isHighlight: true,
            };
            appendChatMessage(highlightMessage);
          }
        });

        // 일반 강조 메시지 수신 (채팅창에 표시용)
        socket.on("highlight_message", (message) => {
          // 채팅창이 열려있으면 강조 메시지 추가
          if (isChatOpen) {
            const highlightMessage = {
              ...message,
              isHighlight: true,
            };
            appendChatMessage(highlightMessage);
            // 스크롤을 맨 아래로
            setTimeout(() => {
              if (chatMessages) {
                chatMessages.scrollTop = chatMessages.scrollHeight;
              }
            }, 100);
          } else {
            // 채팅창이 닫혀있으면 읽지 않은 메시지 카운트 증가
            unreadChatCount++;
            updateChatNotificationBadge();
          }
        });

        // 채팅 메시지 삭제 (관리자가 삭제한 경우)
        socket.on("chat_message_deleted", (data) => {
          const messageElements =
            chatMessages?.querySelectorAll(".chat-message");
          if (messageElements) {
            messageElements.forEach((el) => {
              // 메시지 ID로 찾아서 삭제 (실제로는 데이터 속성을 추가해야 하지만 간단하게 구현)
              // 여기서는 전체 채팅 기록을 다시 로드하는 방식으로 처리
            });
            // 채팅 기록 다시 로드
            if (isChatOpen) {
              loadChatHistory();
            }
          }
        });

        // 채팅 참여 신호
        socket.emit("join_chat");

        // 이전 통계 상태 저장 (변경 감지용)
        let previousStats = {};

        // 베팅 통계 표시 업데이트 함수 (최적화)
        function updateBettingStatsDisplay(stats) {
          // requestAnimationFrame을 사용하여 렌더링 최적화
          requestAnimationFrame(() => {
            const totalMainBetsCount =
              (stats.player?.count || 0) +
              (stats.banker?.count || 0) +
              (stats.tie?.count || 0);

            function formatAmount(amount) {
              if (amount >= 1000000) {
                return (amount / 1000000).toFixed(1).replace(".0", "") + "M";
              }
              if (amount >= 1000) {
                return (amount / 1000).toFixed(1).replace(".0", "") + "K";
              }
              return amount.toString();
            }

            function updateSection(sectionKey, statsData) {
              // 이전 값과 비교하여 변경된 경우에만 업데이트
              const prevData = previousStats[sectionKey] || {};
              const count = statsData?.count || 0;
              const totalAmount =
                statsData?.total_bet_amount || statsData?.total || 0;
              const bettorCount = statsData?.bettor_count || 0;

              // 변경 사항이 없으면 건너뛰기
              if (
                prevData.count === count &&
                prevData.totalAmount === totalAmount &&
                prevData.bettorCount === bettorCount &&
                prevData.totalMainBetsCount === totalMainBetsCount
              ) {
                return;
              }

              // 이전 값 저장
              previousStats[sectionKey] = {
                count,
                totalAmount,
                bettorCount,
                totalMainBetsCount,
              };

              const sectionElement = document.getElementById(
                `${sectionKey}Stats`
              );
              if (!sectionElement) return;

              const percentageElement =
                sectionElement.querySelector(".percentage-circle");
              const totalBetElement = sectionElement.querySelector(
                ".stats-details .total-bet"
              );
              const bettorCountElement = sectionElement.querySelector(
                ".stats-details .bettor-count"
              );

              let percentage = 0;

              if (percentageElement) {
                if (
                  totalMainBetsCount > 0 &&
                  (sectionKey === "player" ||
                    sectionKey === "banker" ||
                    sectionKey === "tie")
                ) {
                  percentage = ((count / totalMainBetsCount) * 100).toFixed(0);
                }
                const newText = `${percentage}%`;
                if (percentageElement.textContent !== newText) {
                  percentageElement.textContent = newText;
                }
              }

              if (totalBetElement) {
                const newText = `${formatAmount(totalAmount)}코인`;
                if (totalBetElement.textContent !== newText) {
                  totalBetElement.textContent = newText;
                }
              }

              if (bettorCountElement) {
                const newHTML = `<i class="fas fa-users"></i> ${bettorCount}`;
                if (bettorCountElement.innerHTML !== newHTML) {
                  bettorCountElement.innerHTML = newHTML;
                  bettorCountElement.classList.remove("hidden");
                }
              }
            }

            if (stats.player) updateSection("player", stats.player);
            if (stats.banker) updateSection("banker", stats.banker);
            if (stats.tie) updateSection("tie", stats.tie);
            if (stats.player_pair)
              updateSection("player_pair", stats.player_pair);
            if (stats.banker_pair)
              updateSection("banker_pair", stats.banker_pair);
          });
        }

        socket.on("betting_status", (status) => {
          bettingActive = status.active;
          if (status.stats) {
            updateBettingStatsDisplay(status.stats);
          }

          // 베팅이 활성화되어 있고 종료 시간이 있으면 타이머 시작
          if (status.active && status.endTime) {
            const gameStatusEl = document.getElementById("gameStatus");
            if (gameStatusEl) {
              gameStatusEl.innerText = "베팅 진행중";
              gameStatusEl.className = "text-xl font-bold text-yellow-500 mb-1";
            }

            const endTime = new Date(status.endTime);
            startTimer(endTime);

            // 내 베팅 정보 요청
            socket.emit("request_my_bets", token);
          }
        });

        // 배치 업데이트를 위한 변수
        let statsUpdateTimer = null;
        let pendingStatsUpdate = null;

        socket.on("new_bet", (data) => {
          if (data.stats) {
            // 배치 업데이트가 아닌 경우 디바운싱 적용
            if (!data.batchUpdate) {
              pendingStatsUpdate = data.stats;

              if (statsUpdateTimer) {
                clearTimeout(statsUpdateTimer);
              }

              statsUpdateTimer = setTimeout(() => {
                if (pendingStatsUpdate) {
                  updateBettingStatsDisplay(pendingStatsUpdate);
                  pendingStatsUpdate = null;
                }
              }, 50); // 50ms 디바운싱
            } else {
              // 배치 업데이트인 경우 즉시 적용
              updateBettingStatsDisplay(data.stats);
            }
          }
        });

        // ##### 내 베팅액 관련 로직 #####
        function formatMyBetAmount(amount) {
          if (amount >= 1000000) {
            return (amount / 1000000).toFixed(1).replace(".0", "") + "M";
          }
          if (amount >= 1000) {
            return (amount / 1000).toFixed(1).replace(".0", "") + "K";
          }
          return amount.toString();
        }

        function updateMyBetAmounts(myBets) {
          const choices = [
            "player",
            "banker",
            "tie",
            "player_pair",
            "banker_pair",
          ];

          // 총 베팅 금액 계산
          let totalBetAmount = 0;
          choices.forEach((choice) => {
            const myBetEl = document.querySelector(
              `#${choice}Stats .my-bet-amount`
            );
            if (myBetEl) {
              const amount = myBets && myBets[choice] ? myBets[choice] : 0;
              totalBetAmount += amount;
              if (amount > 0) {
                myBetEl.textContent = `나${formatMyBetAmount(amount)}`;
                myBetEl.style.display = "block";
              } else {
                myBetEl.textContent = "";
                myBetEl.style.display = "none";
              }
            }
          });

          // 헤더의 총 베팅 금액 업데이트
          const totalBetAmountEl = document.getElementById("totalBetAmount");
          if (totalBetAmountEl) {
            totalBetAmountEl.textContent = `총 베팅: ${totalBetAmount.toLocaleString()}코인`;
          }
        }

        socket.on("my_bets_updated", (data) => {
          if (data && data.myCurrentBetsOnChoices) {
            currentBets = data.myCurrentBetsOnChoices; // 현재 베팅 상황 업데이트
            updateMyBetAmounts(data.myCurrentBetsOnChoices);
          }
        });
        // ##### 내 베팅액 관련 로직 끝 #####

        // 예측 관련 변수
        let currentPrediction = null;

        // 예측 표시 함수
        function addPrediction(predictionType) {
          // 기존 예측 제거
          removePrediction();

          const container = document.getElementById("recentResults");
          if (!container) return;

          // 마지막 컬럼 찾기
          const columns = container.querySelectorAll(
            ".result-column:not(.prediction-column)"
          );
          let lastColumn = columns[columns.length - 1];
          let shouldCreateNewColumn = true;

          // 마지막 컬럼이 있고, 6개 미만이고, 마지막 결과와 같은 타입이면 그 컬럼에 추가
          if (
            lastColumn &&
            lastColumn.children.length > 0 &&
            lastColumn.children.length < 6
          ) {
            const lastResultElement =
              lastColumn.children[lastColumn.children.length - 1];
            const lastResultType = lastResultElement.classList.contains(
              "player"
            )
              ? "player"
              : lastResultElement.classList.contains("banker")
              ? "banker"
              : "tie";

            if (lastResultType === predictionType) {
              shouldCreateNewColumn = false;
            }
          }

          let targetColumn;
          if (shouldCreateNewColumn) {
            // 새로운 예측 컬럼 생성
            targetColumn = document.createElement("div");
            targetColumn.className = "result-column prediction-column";
            targetColumn.id = "predictionColumn";
            container.appendChild(targetColumn);
          } else {
            // 기존 마지막 컬럼을 복사해서 예측 컬럼으로 만들기
            targetColumn = document.createElement("div");
            targetColumn.className = "result-column prediction-column";
            targetColumn.id = "predictionColumn";

            // 기존 결과들을 복사
            Array.from(lastColumn.children).forEach((child) => {
              const clonedElement = child.cloneNode(true);
              targetColumn.appendChild(clonedElement);
            });

            // 원래 컬럼 숨기기
            lastColumn.style.display = "none";
            lastColumn.setAttribute("data-hidden-by-prediction", "true");
            container.appendChild(targetColumn);
          }

          const predictionElement = document.createElement("div");
          predictionElement.className = `result-cell ${predictionType} prediction`;
          // 중국점 스타일이므로 텍스트 없이 색상으로만 표시
          // predictionElement.textContent = predictionType.charAt(0).toUpperCase();
          predictionElement.title = "내 예측";

          targetColumn.appendChild(predictionElement);

          // 스크롤을 맨 오른쪽으로
          container.scrollLeft = container.scrollWidth;

          currentPrediction = predictionType;
        }

        // 예측 제거 함수
        function removePrediction() {
          const container = document.getElementById("recentResults");
          if (!container) return;

          // 숨겨진 컬럼을 다시 보이게 하기
          const hiddenColumn = container.querySelector(
            '[data-hidden-by-prediction="true"]'
          );
          if (hiddenColumn) {
            hiddenColumn.style.display = "";
            hiddenColumn.removeAttribute("data-hidden-by-prediction");
          }

          // 예측 컬럼 제거
          const predictionColumn = document.getElementById("predictionColumn");
          if (predictionColumn) {
            predictionColumn.remove();
          }
          currentPrediction = null;
        }

        // 예측 버튼 이벤트 리스너
        document
          .getElementById("predictPlayer")
          ?.addEventListener("click", () => {
            addPrediction("player");
          });

        document
          .getElementById("predictBanker")
          ?.addEventListener("click", () => {
            addPrediction("banker");
          });

        document.getElementById("predictTie")?.addEventListener("click", () => {
          addPrediction("tie");
        });

        // 초기화 호출들
        updateBettingStatsDisplay({
          player: { count: 0, total: 0, bettor_count: 0, total_bet_amount: 0 },
          banker: { count: 0, total: 0, bettor_count: 0, total_bet_amount: 0 },
          tie: { count: 0, total: 0, bettor_count: 0, total_bet_amount: 0 },
          player_pair: {
            count: 0,
            total: 0,
            bettor_count: 0,
            total_bet_amount: 0,
          },
          banker_pair: {
            count: 0,
            total: 0,
            bettor_count: 0,
            total_bet_amount: 0,
          },
        });
        fetchUserInfo(true); // 초기 로드는 즉시 실행
        fetchRecentGames();
        // 페이지 로드 시 카드 표시 초기화 (서버에 요청하는 대신 직접 클리어 또는 서버가 연결시 보내주는 이벤트 활용)
        // socket.emit("clear_cards_on_user_ui"); // 이 부분은 서버 로직으로 대체됨
        document
          .querySelectorAll(".player-cards .card-slot")
          .forEach((slot) => (slot.textContent = ""));
        document
          .querySelectorAll(".banker-cards .card-slot")
          .forEach((slot) => (slot.textContent = ""));

        setInterval(fetchRecentGames, 30000);

        document
          .getElementById("submitExchange")
          ?.addEventListener("click", async () => {
            const submitButton = document.getElementById("submitExchange");
            const amountValue = parseInt(exchangeAmountInput?.value || "0");

            // 입력값 검증
            if (!amountValue || isNaN(amountValue) || amountValue < 10) {
              showNotification(
                "올바른 환전 금액을 입력해주세요. (최소 10코인)"
              );
              return;
            }

            if (submitButton) {
              submitButton.disabled = true;
              submitButton.textContent = "처리중...";
            }
            try {
              const response = await fetch(
                "http://127.0.0.1:5000/api/exchange/request",
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    amount: amountValue,
                  }),
                }
              );
              const data = await response.json();
              if (response.ok) {
                // 환전 완료 모달 표시
                showExchangeRequestModal(amountValue, data.newBalance);

                if (chargeExchangeModal)
                  chargeExchangeModal.classList.add("hidden");
                if (exchangeAmountInput) exchangeAmountInput.value = "";
                if (exchangePreview) exchangePreview.classList.add("hidden");
                await fetchUserInfo();
                await fetchExchangeHistory();
              } else {
                showNotification(data.message || "환전 신청에 실패했습니다.");
              }
            } catch (error) {
              console.error("환전 신청 에러:", error);
              showNotification("서버 연결 오류가 발생했습니다.");
            } finally {
              if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = "환전 신청하기";
              }
            }
          });

        // 모달 열기/닫기 이벤트 리스너
        if (
          showChargeExchangeButton &&
          chargeExchangeModal &&
          closeChargeExchangeButton
        ) {
          showChargeExchangeButton.addEventListener("click", () => {
            fetchUserInfo(); // 모달 열기 전 최신 정보 로드
            chargeExchangeModal.classList.remove("hidden");
            switchTab("charge"); // 기본적으로 충전 탭 활성화
          });
          closeChargeExchangeButton.addEventListener("click", () => {
            chargeExchangeModal.classList.add("hidden");
          });
        }

        if (showHistoryButton && historyModal && closeHistoryButton) {
          showHistoryButton.addEventListener("click", () => {
            historyModal.classList.remove("hidden");
            fetchUserInfo(); // 베팅 기록은 fetchUserInfo에서 displayBettingHistory를 호출
          });
          closeHistoryButton.addEventListener("click", () => {
            historyModal.classList.add("hidden");
          });
        }

        if (showMyInfoButton && myInfoModal && closeMyInfoButton) {
          showMyInfoButton.addEventListener("click", () => {
            myInfoModal.classList.remove("hidden");
            switchMyInfoTab("overview"); // 기본적으로 개요 탭 활성화
            fetchDetailedUserInfo(); // 상세 정보 가져오기
          });
          closeMyInfoButton.addEventListener("click", () => {
            myInfoModal.classList.add("hidden");
          });
        }

        // 승리 메시지 표시 함수
        function showWinMessage(winnings) {
          if (winMessage) {
            const messageDiv = winMessage.querySelector("div");
            const winAmountDisplay =
              document.getElementById("winAmountDisplay");

            // 이긴 금액 표시
            if (winAmountDisplay && winnings) {
              winAmountDisplay.textContent = `${winnings.toLocaleString()}코인`;
            }

            // 메시지 표시
            winMessage.classList.remove("hidden");
            messageDiv.classList.add("win-message-enter");

            // 승리 사운드는 game_result에서 이미 재생되므로 여기서는 재생하지 않음
            // (페어 베팅과 메인 베팅이 겹칠 때 중복 사운드 방지)

            // 1.2초 후 사라지는 애니메이션 시작
            setTimeout(() => {
              messageDiv.classList.remove("win-message-enter");
              messageDiv.classList.add("win-message-exit");

              // 애니메이션 완료 후 숨기기
              setTimeout(() => {
                winMessage.classList.add("hidden");
                messageDiv.classList.remove("win-message-exit");
              }, 300);
            }, 1200);
          }
        }

        // 내 정보 모달 탭 이벤트 리스너
        const overviewTab = document.getElementById("overviewTab");
        const bettingTab = document.getElementById("bettingTab");
        const financialTab = document.getElementById("financialTab");

        if (overviewTab)
          overviewTab.addEventListener("click", () =>
            switchMyInfoTab("overview")
          );
        if (bettingTab)
          bettingTab.addEventListener("click", () =>
            switchMyInfoTab("betting")
          );
        if (financialTab)
          financialTab.addEventListener("click", () =>
            switchMyInfoTab("financial")
          );

        // 환전 내역 가져오기 함수
        async function fetchExchangeHistory() {
          try {
            const res = await fetch(
              "http://127.0.0.1:5000/api/exchange/history",
              {
                headers: { Authorization: `Bearer ${token}` },
              }
            );
            if (res.ok) {
              const exchanges = await res.json();
              const exchangeHistoryList = document.getElementById(
                "exchangeHistoryList"
              );
              if (exchangeHistoryList) {
                exchangeHistoryList.innerHTML = ""; // 기존 내용 초기화
                if (exchanges.length === 0) {
                  exchangeHistoryList.innerHTML = `<div class="text-center text-gray-400 py-4">환전 내역이 없습니다.</div>`;
                  return;
                }
                exchanges.forEach((exchange) => {
                  const card = createExchangeHistoryCard(exchange); // 이미 정의된 함수 사용
                  exchangeHistoryList.appendChild(card);
                });
              }
            } else {
              showNotification("환전 내역을 가져오는 데 실패했습니다.");
            }
          } catch (err) {
            console.error("환전 내역 조회 에러:", err);
            showNotification("서버 연결 오류가 발생했습니다.");
          }
        }

        // 환전 금액 입력 및 미리보기 로직
        if (
          exchangeAmountInput &&
          requestAmountSpan &&
          feeAmountSpan &&
          actualAmountSpan &&
          exchangePreview &&
          modalCoinBalance2 &&
          rollingInfoDiv &&
          submitExchangeButton
        ) {
          exchangeAmountInput.addEventListener("input", () => {
            const amount = parseInt(exchangeAmountInput.value);

            if (isNaN(amount) || amount <= 0) {
              exchangePreview.classList.add("hidden");
              submitExchangeButton.disabled = true;
              return;
            }

            // 수수료 정책 (10% 소수점 올림)
            const fee = Math.ceil(amount * 0.1);
            const actual = amount - fee;

            requestAmountSpan.textContent = `${amount.toLocaleString()}코인`;
            feeAmountSpan.textContent = `${fee.toLocaleString()}코인`;
            actualAmountSpan.textContent = `${actual.toLocaleString()}코인`;
            exchangePreview.classList.remove("hidden");

            // 환전 가능 금액 가져오기
            const maxExchangeText = document
              .getElementById("maxExchangeAmount")
              .textContent.replace(/[^0-9]/g, "");
            const maxExchangeAmount = parseInt(maxExchangeText) || 0;

            if (amount < 10 || amount > maxExchangeAmount) {
              submitExchangeButton.disabled = true;
            } else {
              submitExchangeButton.disabled = false;
            }
          });
        }

        // 환전 모달 '최대' 버튼 클릭 리스너
        if (
          maxAmountButton &&
          exchangeAmountInput &&
          modalCoinBalance2 &&
          rollingInfoDiv
        ) {
          maxAmountButton.addEventListener("click", () => {
            // 환전 가능 금액 가져오기
            const maxExchangeText = document
              .getElementById("maxExchangeAmount")
              .textContent.replace(/[^0-9]/g, "");
            const maxExchangeAmount = parseInt(maxExchangeText) || 0;

            if (maxExchangeAmount > 0) {
              // 환전 가능 금액 설정
              exchangeAmountInput.value = maxExchangeAmount;
            } else {
              // 환전 가능 금액이 없음
              exchangeAmountInput.value = 0;
              showNotification(
                "환전 가능한 금액이 없습니다. 베팅을 먼저 해주세요."
              );
            }

            // 수동으로 input 이벤트 트리거하여 미리보기 업데이트
            exchangeAmountInput.dispatchEvent(new Event("input"));
          });
        }

        // Phaser 미니게임 Scene 정의
        class BaccaratSceneMini extends Phaser.Scene {
          constructor() {
            super({ key: "BaccaratSceneMini" });
            this.cardSprites = { player: [], banker: [] }; // Phaser Image 객체 저장
            this.handsData = { player: [], banker: [] }; // 카드 값(문자열) 저장
            this.socket = socket;
            this.cardScale = 0.3; // 미니게임 카드 크기 (모바일 최적화)
            this.cardSpacing = 45; // 미니게임 카드 간격 (모바일 최적화)
          }

          preload() {
            // 카드 이미지 프리로드 (모든 숫자와 무늬 조합)
            const suits = ["H", "D", "C", "S"]; // Hearts, Diamonds, Clubs, Spades (deckofcardsapi.com 형식)
            const values = [
              "A",
              "2",
              "3",
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              "0", // 0은 10을 의미
              "J",
              "Q",
              "K",
            ];

            suits.forEach((suit) => {
              values.forEach((value) => {
                // deckofcardsapi.com에서 사용하는 카드 코드 생성 (예: AH, 2S, 0D 등)
                const cardCode = `${value}${suit}`;
                const imageUrl = `https://deckofcardsapi.com/static/img/${cardCode}.png`;

                // 로드 에러 핸들러 추가
                this.load.image(cardCode, imageUrl);
                this.load.on(`loaderror`, (file) => {
                  if (file.key === cardCode) {
                    console.error(
                      `[MiniGame] Failed to load: ${cardCode} from ${imageUrl}`
                    );
                  }
                });
              });
            });

            // 예비용 또는 기본 카드 이미지 (선택 사항)
            this.load.image(
              "card_back",
              "https://deckofcardsapi.com/static/img/back.png"
            );
          }

          create() {
            const width = this.cameras.main.width;
            const height = this.cameras.main.height;
            const centerX = width / 2;
            const centerY = height / 2;

            // 바카라 테이블 배경 생성
            this.createBaccaratTable(width, height, centerX, centerY);

            // 텍스트 스타일 정의
            const textStyle = {
              fontSize: "14px",
              fontFamily: '"Noto Serif KR", serif',
              color: "#ffffff",
              stroke: "#000000",
              strokeThickness: 2,
            };
            const scoreTextStyle = {
              ...textStyle,
              fontSize: "16px",
              color: "#ffd700",
              fontWeight: "bold",
            };
            const resultTextStyle = {
              ...textStyle,
              fontSize: "20px",
              color: "#FFD700",
              backgroundColor: "rgba(0,0,0,0.8)",
              padding: { x: 12, y: 6 },
              borderRadius: 8,
              fontWeight: "bold",
            };

            // 플레이어/뱅커 라벨
            this.add.text(centerX / 2, 25, "PLAYER", textStyle).setOrigin(0.5);
            this.add
              .text(centerX + centerX / 2, 25, "BANKER", textStyle)
              .setOrigin(0.5);

            // 점수 텍스트
            this.playerScoreText = this.add
              .text(centerX / 2, height - 25, "", scoreTextStyle)
              .setOrigin(0.5);
            this.bankerScoreText = this.add
              .text(centerX + centerX / 2, height - 25, "", scoreTextStyle)
              .setOrigin(0.5);

            // 게임 결과 텍스트
            this.gameResultText = this.add
              .text(centerX, centerY + 30, "", resultTextStyle)
              .setOrigin(0.5)
              .setVisible(false)
              .setDepth(10);

            this.clearAllCardsAndText();
          }

          createBaccaratTable(width, height, centerX, centerY) {
            const g = this.add.graphics();

            // 테이블 배경: 진한, 고급스러운 녹색
            const feltColor = 0x043521;
            g.fillStyle(feltColor, 1);
            g.fillRoundedRect(0, 0, width, height, 12);

            // PLAYER, BANKER 영역에 은은한 하이라이트
            g.fillStyle(0xffffff, 0.03);
            g.fillRoundedRect(10, 40, centerX - 20, height - 80, 10);
            g.fillRoundedRect(centerX + 10, 40, centerX - 20, height - 80, 10);
          }

          // 카드 값 계산 (game.html에서 가져옴) - NaN 방지 개선
          calculateCardValue(cardChar) {
            // 입력값 검증
            if (!cardChar || typeof cardChar !== "string") {
              return 0;
            }

            // 10, J, Q, K는 0점 (T는 10을 의미하므로 0점)
            if (["J", "Q", "K", "0", "T"].includes(cardChar)) return 0;

            // A는 1점
            if (cardChar === "A") return 1;

            // 숫자 카드 처리 (2-9)
            const numValue = parseInt(cardChar);
            if (isNaN(numValue)) {
              return 0; // NaN 대신 0 반환
            }

            return numValue;
          }

          calculateHandValue(handData) {
            // handData는 ['A', 'K'] 와 같은 문자열 배열
            if (!Array.isArray(handData)) {
              return 0;
            }

            let value = 0;
            for (let cardChar of handData) {
              const cardValue = this.calculateCardValue(cardChar);
              if (isNaN(cardValue)) {
                continue; // NaN인 카드는 건너뛰기
              }
              value = (value + cardValue) % 10;
            }
            return value;
          }

          displayCard(
            target,
            cardValueFromServer,
            cardSuitFromServer,
            cardIndex,
            isNewHand
          ) {
            // 입력값 검증
            if (!cardValueFromServer || !cardSuitFromServer) {
              return;
            }

            const width = this.cameras.main.width;
            const height = this.cameras.main.height;
            const centerX = width / 2;
            const cardY = height / 2; // 중앙 높이로 조정

            let actualCardValue = cardValueFromServer; // 'A', '2', ..., '9', '0', 'J', 'Q', 'K'
            // 서버에서 이미 '0'으로 오는 10, J, Q, K는 cardKey 생성 시 그대로 사용
            // deckofcardsapi.com은 10을 0으로 표현 (예: 0H, 0S)

            const suitInitial = cardSuitFromServer.charAt(0).toUpperCase(); // 'H', 'D', 'C', 'S'
            const cardKey = `${actualCardValue}${suitInitial}`;

            let handDataRef = this.handsData[target];
            let cardSpritesRef = this.cardSprites[target];
            let baseStartX;

            // 카드의 기본 X 위치 설정 (안전한 여백 확보)
            const cardWidth = 70 * this.cardScale; // 대략적인 카드 너비
            const safeMargin = cardWidth + 15; // 안전 여백 (더 넉넉하게)

            if (target === "player") {
              baseStartX = Math.max(safeMargin, centerX * 0.45); // 플레이어 영역
            } else {
              // banker
              baseStartX = Math.min(width - safeMargin, centerX * 1.55); // 뱅커 영역
            }

            // 카드 데이터 저장 (값 검증 추가)
            // 배열 크기를 cardIndex+1로 확장
            while (handDataRef.length <= cardIndex) {
              handDataRef.push(null);
            }
            handDataRef[cardIndex] = actualCardValue;

            // 현재 카드 생성/업데이트
            let cardSprite;
            try {
              if (
                cardSpritesRef[cardIndex] &&
                cardSpritesRef[cardIndex].scene
              ) {
                // 기존 스프라이트가 있고, 파괴되지 않았다면
                cardSprite = cardSpritesRef[cardIndex];
                cardSprite.setTexture(cardKey);
                cardSprite.setAlpha(0).setScale(this.cardScale * 0.8);
                cardSprite.setPosition(baseStartX, cardY - 100);
              } else {
                cardSprite = this.add.image(
                  baseStartX, // 임시 위치
                  cardY - 100, // 시작 위치를 위쪽으로
                  cardKey
                );
                cardSpritesRef[cardIndex] = cardSprite; // 새 스프라이트를 배열에 저장
                cardSprite.setScale(this.cardScale * 0.8).setAlpha(0);

                // 카드 깊이 설정
                cardSprite.setDepth(5);
              }

              // 먼저 카드 뒷면으로 설정
              cardSprite.setTexture("card_back");

              // 카드 등장 애니메이션 (위에서 떨어지는 효과)
              this.tweens.add({
                targets: cardSprite,
                alpha: 1,
                y: cardY,
                scaleX: this.cardScale,
                scaleY: this.cardScale,
                duration: 400,
                ease: "Back.Out",
                onComplete: () => {
                  // 카드 뒤집기 애니메이션
                  this.tweens.add({
                    targets: cardSprite,
                    scaleX: 0,
                    duration: 150,
                    ease: "Power2.In",
                    onComplete: () => {
                      // 카드 앞면으로 변경
                      cardSprite.setTexture(cardKey);

                      // 카드 다시 펼치기
                      this.tweens.add({
                        targets: cardSprite,
                        scaleX: this.cardScale,
                        duration: 150,
                        ease: "Power2.Out",
                      });
                    },
                  });
                },
              });
            } catch (error) {
              console.error(
                `[MiniGame] Error displaying card ${cardKey}:`,
                error
              );
            }

            // 모든 카드의 위치를 다시 계산하고 업데이트
            this.repositionAllCards(target);

            this.updateScores();
          }

          // 모든 카드의 위치를 다시 계산하여 배치하는 함수
          repositionAllCards(target) {
            const width = this.cameras.main.width;
            const centerX = width / 2;
            let baseStartX;

            // 카드의 기본 X 위치 설정 (안전한 여백 확보)
            const cardWidth = 70 * this.cardScale; // 대략적인 카드 너비
            const safeMargin = cardWidth + 15; // 안전 여백 (더 넉넉하게)

            if (target === "player") {
              baseStartX = Math.max(safeMargin, centerX * 0.45); // 플레이어 영역
            } else {
              baseStartX = Math.min(width - safeMargin, centerX * 1.55); // 뱅커 영역
            }

            const handDataRef = this.handsData[target];
            const cardSpritesRef = this.cardSprites[target];

            // 실제 존재하는 카드 수 계산 (null이 아닌 카드들)
            const existingCards = [];
            for (let i = 0; i < handDataRef.length; i++) {
              if (
                handDataRef[i] !== null &&
                cardSpritesRef[i] &&
                cardSpritesRef[i].scene
              ) {
                existingCards.push({ index: i, sprite: cardSpritesRef[i] });
              }
            }

            const numCards = existingCards.length;

            // 카드 위치 계산 및 배치
            existingCards.forEach((cardInfo, position) => {
              let xOffset = 0;

              if (numCards === 1) {
                xOffset = 0; // 중앙
              } else if (numCards === 2) {
                xOffset =
                  position === 0 ? -this.cardSpacing / 2 : this.cardSpacing / 2;
              } else if (numCards === 3) {
                if (position === 0) xOffset = -this.cardSpacing;
                else if (position === 1) xOffset = 0;
                else xOffset = this.cardSpacing;
              }

              const finalX = baseStartX + xOffset;

              // 화면 경계 체크 및 조정
              const adjustedX = Math.max(
                safeMargin / 2,
                Math.min(width - safeMargin / 2, finalX)
              );

              // 카드 위치 부드럽게 이동
              this.tweens.add({
                targets: cardInfo.sprite,
                x: adjustedX,
                duration: 300,
                ease: "Power2",
              });
            });
          }

          clearCards(target) {
            let cardSpritesToClear = this.cardSprites[target];
            let handDataToClear = this.handsData[target];

            cardSpritesToClear.forEach((sprite) => {
              if (sprite && typeof sprite.destroy === "function") {
                sprite.destroy();
              }
            });
            cardSpritesToClear.length = 0;
            handDataToClear.length = 0;

            this.updateScores();
          }

          updateScores() {
            const playerScore = this.calculateHandValue(
              this.handsData.player // handsData 사용
            );
            const bankerScore = this.calculateHandValue(
              this.handsData.banker // handsData 사용
            );

            // NaN 체크 및 안전한 표시
            const safePlayerScore = isNaN(playerScore) ? 0 : playerScore;
            const safeBankerScore = isNaN(bankerScore) ? 0 : bankerScore;

            this.playerScoreText.setText(`P: ${safePlayerScore}`);
            this.bankerScoreText.setText(`B: ${safeBankerScore}`);
          }

          setGameResult(result, pScore, bScore) {
            let message = "";
            let resultColor = "#FFD700";

            if (result === "player") {
              message = `PLAYER WIN!\n(${pScore} vs ${bScore})`;
              resultColor = "#4169E1"; // 파란색
            } else if (result === "banker") {
              message = `BANKER WIN! \n(${pScore} vs ${bScore})`;
              resultColor = "#DC143C"; // 빨간색
            } else if (result === "tie") {
              message = `TIE\n(${pScore} vs ${bScore})`;
              resultColor = "#32CD32"; // 녹색
            }

            this.gameResultText.setText(message);
            this.gameResultText.setStyle({ color: resultColor });
            this.gameResultText.setVisible(true);
            this.gameResultText.setAlpha(0).setScale(0.5);

            // 화려한 결과 텍스트 애니메이션
            this.tweens.add({
              targets: this.gameResultText,
              alpha: 1,
              scaleX: 1.2,
              scaleY: 1.2,
              duration: 300,
              ease: "Back.Out",
              onComplete: () => {
                // 살짝 줄어드는 효과
                this.tweens.add({
                  targets: this.gameResultText,
                  scaleX: 1,
                  scaleY: 1,
                  duration: 200,
                  ease: "Power2",
                  onComplete: () => {
                    // 반짝이는 효과
                    this.tweens.add({
                      targets: this.gameResultText,
                      alpha: 0.7,
                      duration: 500,
                      yoyo: true,
                      repeat: 2,
                      ease: "Power2",
                    });
                  },
                });
              },
            });

            // 배경 번쩍임 효과
            const flashGraphics = this.add.graphics();
            flashGraphics.fillStyle(0xffffff, 0.3);
            flashGraphics.fillRect(
              0,
              0,
              this.cameras.main.width,
              this.cameras.main.height
            );
            flashGraphics.setDepth(8);

            this.tweens.add({
              targets: flashGraphics,
              alpha: 0,
              duration: 500,
              ease: "Power2",
              onComplete: () => flashGraphics.destroy(),
            });
          }

          clearAllCardsAndText() {
            this.clearCards("player");
            this.clearCards("banker");
            this.playerScoreText.setText("P: 0");
            this.bankerScoreText.setText("B: 0");
            if (this.gameResultText) {
              this.gameResultText.setVisible(false);
            }
          }
        }

        // Phaser 게임 시작 함수
        function startMiniGame() {
          const container = document.getElementById("miniGameContainer");
          if (!container) {
            console.error("miniGameContainer not found!");
            return;
          }

          const config = {
            type: Phaser.AUTO, // AUTO는 WebGL 우선, 안되면 Canvas 사용
            parent: "miniGameContainer",
            width: container.clientWidth, // 컨테이너 너비에 맞춤
            height: container.clientHeight, // 컨테이너 높이에 맞춤
            transparent: true, // 배경 투명하게
            scene: BaccaratSceneMini,
            scale: {
              mode: Phaser.Scale.FIT, // 컨테이너에 맞게 스케일 조정
              autoCenter: Phaser.Scale.CENTER_BOTH,
            },
          };
          if (miniGame) {
            // 기존 게임 인스턴스가 있다면 파괴
            miniGame.destroy(true);
          }
          miniGame = new Phaser.Game(config);

          // Scene 인스턴스를 게임의 'ready' 이벤트 발생 시점에 가져옵니다.
          // 이렇게 하면 Scene Manager가 Scene을 처리할 충분한 시간을 갖게 됩니다.
          miniGame.events.on("ready", () => {
            // console.log("Phaser Game is READY.");
            if (miniGame && miniGame.scene) {
              baccaratSceneMini = miniGame.scene.getScene("BaccaratSceneMini");
              if (!baccaratSceneMini) {
                console.error(
                  "BaccaratSceneMini 인스턴스를 game READY 이벤트 후에도 가져올 수 없습니다. 소켓 이벤트 연동에 문제가 있을 수 있습니다."
                );
              } else {
                // console.log("BaccaratSceneMini instance obtained after game READY event.");
                // BaccaratSceneMini의 create() 메소드에서 필요한 초기화 (예: clearAllCardsAndText)를 수행합니다.
              }
            } else {
              console.error(
                "Phaser Game 또는 Scene Manager가 game READY 이벤트 시점에 유효하지 않습니다."
              );
            }
          });

          // 즉시 baccaratSceneMini를 확인하는 로직은 제거합니다.
          // if (!baccaratSceneMini) {
          //      console.error("BaccaratSceneMini 인스턴스를 가져올 수 없습니다. 소켓 이벤트가 미니게임과 정상적으로 연동되지 않을 수 있습니다.");
          // }
          // 참고: BaccaratSceneMini의 create() 메소드에서 이미 clearAllCardsAndText()를 호출합니다.
        }

        // 창 크기 변경 시 게임 리사이즈
        window.addEventListener("resize", () => {
          if (miniGame) {
            const container = document.getElementById("miniGameContainer");
            if (container) {
              // 게임 내부적으로 리사이즈 처리 (FIT 모드 사용 시 Phaser가 알아서 처리)
              // 필요하다면 scene의 layout을 재구성하는 함수 호출
              // miniGame.scale.resize(container.clientWidth, container.clientHeight);
              // if (baccaratSceneMini && baccaratSceneMini.sys.isActive()) {
              //    baccaratSceneMini.cameras.main.setViewport(0,0, container.clientWidth, container.clientHeight);
              //    baccaratSceneMini.create(); // 레이아웃 재구성 (create를 다시 호출하는 것은 비효율적일 수 있음)
              // }
            }
          }
        });

        // DOMContentLoaded 이후 게임 시작 및 Socket 이벤트 핸들러 수정/추가
        startMiniGame(); // 페이지 로드 시 미니게임 시작

        // 기존 카드 표시 이벤트 (game.html 호환)
        socket.on("display_card_on_user_html", (data) => {
          // console.log("[user.html] Received display_card_on_user_html from server:", data);
          if (baccaratSceneMini && baccaratSceneMini.sys.isActive()) {
            const { target, cardValue, cardSuit, cardIndex, isNewHand } = data;
            if (isNewHand && cardIndex === 0) {
              // console.log(`[MiniGame] New hand for ${target}, clearing previous cards.`);
              baccaratSceneMini.clearCards(
                target === "player" ? "player" : "banker"
              ); // 해당 타겟의 카드만 클리어
            }
            baccaratSceneMini.displayCard(
              target,
              cardValue,
              cardSuit,
              cardIndex,
              isNewHand
            );
          } else {
            // console.warn("[user.html] BaccaratSceneMini not active or not available when receiving card data.");
          }
        });

        // 새로운 카드 표시 이벤트 (admin 시스템 호환)
        socket.on("card_dealt_to_user_ui", (data) => {
          if (baccaratSceneMini && baccaratSceneMini.sys.isActive()) {
            const { target, cardValue, cardSuit, cardIndex, isNewHand } = data;
            if (isNewHand && cardIndex === 0) {
              baccaratSceneMini.clearCards(
                target === "player" ? "player" : "banker"
              ); // 해당 타겟의 카드만 클리어
            }
            baccaratSceneMini.displayCard(
              target,
              cardValue,
              cardSuit,
              cardIndex,
              isNewHand
            );
          }
        });

        socket.on("clear_cards_display_on_user_html", () => {
          // console.log("[user.html] Received clear_cards_display_on_user_html from server");
          if (baccaratSceneMini && baccaratSceneMini.sys.isActive()) {
            baccaratSceneMini.clearAllCardsAndText();
          }
        });
      }); // DOMContentLoaded event listener 닫기