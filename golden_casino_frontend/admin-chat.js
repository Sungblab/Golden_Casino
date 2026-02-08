      // ===========================
      // 채팅 관련 변수 및 함수들 (Admin)
      // ===========================

      let isChatOpen = false;
      let unreadChatCount = 0;
      let isHighlightMode = false;

      // 채팅 관련 DOM 요소들
      const chatFloatingButton = document.getElementById("chatFloatingButton");
      const chatWindow = document.getElementById("chatWindow");
      const closeChatButton = document.getElementById("closeChatButton");
      const chatMessages = document.getElementById("chatMessages");
      const chatMessageInput = document.getElementById("chatMessageInput");
      const sendChatButton = document.getElementById("sendChatButton");
      const chatCharCount = document.getElementById("chatCharCount");
      const chatNotificationBadge = document.getElementById(
        "chatNotificationBadge"
      );
      const chatNotificationCount = document.getElementById(
        "chatNotificationCount"
      );
      const highlightMessageBtn = document.getElementById(
        "highlightMessageBtn"
      );
      const highlightIndicator = document.getElementById("highlightIndicator");

      // 채팅창 열기/닫기
      function toggleChat() {
        if (isChatOpen) {
          closeChatWindow();
        } else {
          openChatWindow();
        }
      }

      function openChatWindow() {
        if (chatWindow && chatFloatingButton) {
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
        if (chatWindow && chatFloatingButton) {
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
        }`;

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
        const deleteBtn =
          "<button onclick=\"deleteChatMessage('" +
          message._id +
          '\')" class="text-red-400 hover:text-red-300 text-xs ml-2" title="메시지 삭제"><svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" clip-rule="evenodd"></path><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg></button>';

        messageEl.innerHTML = `
          <div class="flex flex-col ${
            message.isAdmin
              ? "bg-yellow-500 bg-opacity-10 border border-yellow-500 rounded-lg p-3"
              : "bg-gray-700 bg-opacity-50 rounded-lg p-3"
          }">
            <div class="flex items-center justify-between mb-1">
              <div class="flex items-center">
                ${adminBadge}
                <span class="font-bold ${
                  message.isAdmin ? "text-yellow-400" : "text-white"
                } text-sm">${escapeHtml(message.username)}</span>
              </div>
              <div class="flex items-center">
                <span class="text-gray-400 text-xs">${timeStr}</span>
                ${deleteBtn}
              </div>
            </div>
            <p class="text-white text-sm break-words">${escapeHtml(
              message.message
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
          // Socket으로 메시지 전송 (더 빠른 응답을 위해)
          socket.emit("send_chat_message", { message });

          // 입력창 초기화
          if (chatMessageInput) {
            chatMessageInput.value = "";
            updateCharCount();
          }

          // 강조 모드 해제
          if (isHighlightMode) {
            toggleHighlightMode();
          }
        } catch (err) {
          console.error("채팅 전송 오류:", err);
          showToast("채팅 전송에 실패했습니다.");
        }
      }

      // 채팅 메시지 삭제 (관리자만)
      async function deleteChatMessage(messageId) {
        if (!confirm("이 메시지를 삭제하시겠습니까?")) return;

        try {
          const res = await fetch(
            `http://127.0.0.1:5000/api/chat/message/${messageId}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (res.ok) {
            showToast("메시지가 삭제되었습니다.");
            // 채팅 기록 다시 로드
            loadChatHistory();
          } else {
            showToast("메시지 삭제에 실패했습니다.");
          }
        } catch (err) {
          console.error("메시지 삭제 오류:", err);
          showToast("메시지 삭제 중 오류가 발생했습니다.");
        }
      }

      // 강조 메시지 모드 토글
      function toggleHighlightMode() {
        isHighlightMode = !isHighlightMode;

        if (isHighlightMode) {
          highlightMessageBtn.classList.remove(
            "bg-yellow-600",
            "hover:bg-yellow-700"
          );
          highlightMessageBtn.classList.add("bg-red-600", "hover:bg-red-700");
          highlightMessageBtn.textContent = "일반 메시지";
          highlightIndicator.classList.remove("hidden");
          chatMessageInput.classList.add("border-red-500");
          chatMessageInput.classList.remove("border-yellow-500");
        } else {
          highlightMessageBtn.classList.remove(
            "bg-red-600",
            "hover:bg-red-700"
          );
          highlightMessageBtn.classList.add(
            "bg-yellow-600",
            "hover:bg-yellow-700"
          );
          highlightMessageBtn.textContent = "강조 메시지";
          highlightIndicator.classList.add("hidden");
          chatMessageInput.classList.remove("border-red-500");
          chatMessageInput.classList.add("border-yellow-500");
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

      // 채팅 이벤트 리스너들
      if (chatFloatingButton) {
        chatFloatingButton.addEventListener("click", toggleChat);
      }

      if (closeChatButton) {
        closeChatButton.addEventListener("click", closeChatWindow);
      }

      if (sendChatButton) {
        sendChatButton.addEventListener("click", sendChatMessage);
      }

      if (highlightMessageBtn) {
        highlightMessageBtn.addEventListener("click", toggleHighlightMode);
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

      // 초기 문자 수 설정
      updateCharCount();

      // 채팅 관련 Socket 이벤트들 (Admin)

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
        }
      });

      // 채팅 메시지 삭제 (자동 업데이트)
      socket.on("chat_message_deleted", (data) => {
        if (isChatOpen) {
          loadChatHistory();
        }
      });

      // 채팅 참여 신호
      socket.emit("join_chat");