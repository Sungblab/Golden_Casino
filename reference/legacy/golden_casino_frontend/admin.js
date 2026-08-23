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

      // 페이지 로드 시 토큰 검증
      validateToken();

      // 인증 오류 처리 함수
      function handleAuthError() {
        console.log("인증 오류가 발생했습니다. 다시 로그인해주세요.");
        localStorage.removeItem("token");
        showToast("로그인이 만료되었습니다. 다시 로그인해주세요.", "error");
        setTimeout(() => {
          window.location.href = "index.html";
        }, 2000);
      }

      let socket = io(
        "http://127.0.0.1:5000"
      );
      let bettingActive = false; // 베팅 상태 추적

      // 토스트 메시지 표시 함수
      function showToast(message, type = "default") {
        const toast = document.getElementById("toast");
        toast.textContent = message;

        // 기존 타입 클래스 제거
        toast.classList.remove("toast-info", "toast-success", "toast-error");

        // 타입별 스타일 적용
        if (type === "info") {
          toast.classList.add("toast-info");
        } else if (type === "success") {
          toast.classList.add("toast-success");
        } else if (type === "error") {
          toast.classList.add("toast-error");
        }

        toast.classList.add("show");
        setTimeout(() => {
          toast.classList.remove("show");
        }, 3000);
      }

      // 관리자 권한 확인을 위한 요청
      async function fetchUsers() {
        try {
          const res = await fetch(
            "http://127.0.0.1:5000/api/admin/users-stats",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (res.status === 403 || res.status === 401) {
            handleAuthError();
            return;
          }

          const stats = await res.json();
          const userTable = document.getElementById("userTable");
          userTable.innerHTML = "";

          stats.forEach((user, index) => {
            const tr = document.createElement("tr");
            tr.classList.add("text-center");
            tr.innerHTML = `
                <td class="py-2">${user.username}</td>
                <td class="py-2">${user.balance} 코인</td>
                <td class="py-2">${user.role}</td>
                <td class="py-2">${user.isApproved ? "승인됨" : "대기 중"}</td>
                <td class="py-2">${user.wins}</td>
                <td class="py-2">${user.losses}</td>
                <td class="py-2">${user.totalBets}</td>
                <td class="py-2">${user.winRate}</td>
                <td class="py-2">${user.profit} 코인</td>
                <td class="py-2">
                    ${
                      !user.isApproved
                        ? `<button data-id="${user.id}" class="approve-user bg-purple-500 text-white px-2 py-1 rounded mr-2">승인</button>`
                        : ""
                    }
                    <button data-id="${
                      user.id
                    }" class="reset-password bg-yellow-500 text-white px-2 py-1 rounded mr-2">비번 초기화</button>
                    <button data-id="${
                      user.id
                    }" class="delete-user bg-red-500 text-white px-2 py-1 rounded mr-2">삭제</button>
                    ${
                      user.role !== "superadmin"
                        ? `
                    <button 
                      onclick="toggleAdmin('${user._id}', '${user.role}')"
                      class="${
                        user.role === "admin"
                          ? "bg-gray-600 hover:bg-gray-700"
                          : "bg-purple-600 hover:bg-purple-700"
                      } text-white px-2.5 py-1.5 rounded text-sm font-medium transition-colors"
                    >
                      ${user.role === "admin" ? "관리자 해제" : "관리자 지정"}
                    </button>
                  `
                        : ""
                    }
                    <button data-id="${
                      user.id
                    }" class="adjust-coins bg-yellow-600 hover:bg-yellow-700 text-white px-2.5 py-1.5 rounded text-sm font-medium transition-colors"
                    >
                      잔액 조절
                    </button>
                    
            `;
            userTable.appendChild(tr);
          });

          // 이벤트 리스너 추가
          document.querySelectorAll(".approve-user").forEach((button) => {
            button.addEventListener("click", function () {
              const userId = this.getAttribute("data-id");
              approveUser(userId);
            });
          });
          document.querySelectorAll(".delete-user").forEach((button) => {
            button.addEventListener("click", function () {
              const userId = this.getAttribute("data-id");
              deleteUser(userId);
            });
          });
          document.querySelectorAll(".reset-password").forEach((button) => {
            button.addEventListener("click", function () {
              const userId = this.getAttribute("data-id");
              resetPassword(userId);
            });
          });
          document.querySelectorAll(".toggle-admin").forEach((button) => {
            button.addEventListener("click", function () {
              const userId = this.getAttribute("data-id");
              const currentRole = this.getAttribute("data-role");
              toggleAdmin(userId, currentRole);
            });
          });
          document.querySelectorAll(".adjust-coins").forEach((button) => {
            button.addEventListener("click", function () {
              const userId = this.getAttribute("data-id");
              adjustCoins(userId);
            });
          });
          document.querySelectorAll(".view-betting").forEach((button) => {
            button.addEventListener("click", viewBettingDetails);
          });
        } catch (err) {}
      }

      async function approveUser(userId) {
        if (!confirm("이 사용자를 승인하시겠습니까?")) return;

        try {
          const res = await fetch(
            `http://127.0.0.1:5000/api/admin/users/${userId}/approve`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
            }
          );

          const data = await res.json();

          if (res.ok) {
            showToast(data.message);
            fetchUsers(); // 목록 새로고침
          } else {
            showToast(data.message || "사용자 승인에 실패했습니다.");
          }
        } catch (err) {
          showToast("서버 에러가 발생했습니다.");
        }
      }

      async function deleteUser(userId) {
        if (!confirm("정말로 이 사용자를 삭제하시겠습니까?")) return;

        try {
          const res = await fetch(
            `http://127.0.0.1:5000/api/admin/users/${userId}`,
            {
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
            }
          );

          const data = await res.json();

          if (res.ok) {
            showToast(data.message);
            fetchUsers(); // 목록 새로고침
          } else {
            showToast(data.message || "사용자 삭제에 실패했습니다.");
          }
        } catch (err) {
          showToast("서버 에러가 발생했습니다.");
        }
      }

      async function resetPassword(e) {
        const userId = e.target.getAttribute("data-id");
        const newPassword = prompt("새 밀번호를 입력하세요:");
        if (newPassword) {
          try {
            const res = await fetch(
              `http://127.0.0.1:5000/api/admin/users/${userId}/reset-password`,
              {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ newPassword }),
              }
            );
            const data = await res.json();
            showToast(data.message);
          } catch (err) {}
        }
      }

      async function toggleAdmin(userId, currentRole) {
        const isAdmin = currentRole === "admin";
        const action = isAdmin ? "해제" : "지정";

        if (!confirm(`이 사용자를 관리자서 ${action}하시겠습니까?`)) return;

        try {
          const res = await fetch(
            `http://127.0.0.1:5000/api/admin/users/${userId}/toggle-admin`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ setAdmin: !isAdmin }),
            }
          );

          if (res.ok) {
            showToast(`관리자가 ${action}되었니다.`);
            fetchUsers();
          } else {
            showToast(`관리자 ${action}에 실패했습니다.`);
          }
        } catch (err) {
          showToast("서버 에러가 발생했습니다.");
        }
      }

      // 실시간 베팅 현황 업데이트 함수 (대대적 개선)
      function updateBettingStats(stats) {
        const betTypes = {
          player: "Player",
          banker: "Banker",
          tie: "Tie",
          player_pair: "PlayerPair",
          banker_pair: "BankerPair",
        };

        let totalBetAmount = 0;
        let totalBetCount = 0;

        // 먼저 총 베팅액을 계산
        for (const type in betTypes) {
          totalBetAmount += stats[type]?.total_bet_amount || 0;
          totalBetCount += stats[type]?.bettor_count || 0;
        }

        // 각 베팅 타입에 대해 UI 업데이트
        for (const type in betTypes) {
          const key = betTypes[type];
          const amount = stats[type]?.total_bet_amount || 0;
          const count = stats[type]?.bettor_count || 0;

          const amountEl = document.getElementById(`admin${key}BetAmount`);
          const countEl = document.getElementById(`admin${key}BetCount`);

          if (amountEl) amountEl.textContent = formatAdminAmount(amount);
          if (countEl) countEl.textContent = `${count}명`;
        }

        // 총계 업데이트
        const totalAmountEl = document.getElementById("adminTotalBetAmount");
        const totalCountEl = document.getElementById("adminTotalBetCount");
        if (totalAmountEl)
          totalAmountEl.textContent = formatAdminAmount(totalBetAmount);
        if (totalCountEl) totalCountEl.textContent = `${totalBetCount}명`;
      }

      // 사용자 테이블에서 특정 사용자의 잔액 실시간 업데이트
      function updateUserBalanceInTable(userId, newBalance) {
        const userTable = document.getElementById("userTable");
        if (!userTable) return;

        const rows = userTable.querySelectorAll("tr");
        rows.forEach((row) => {
          const adjustButton = row.querySelector(
            `.adjust-coins[data-id="${userId}"]`
          );
          if (adjustButton) {
            // 해당 사용자의 행을 찾았으면 잔액 업데이트
            const balanceCell = row.querySelector("td:nth-child(2)"); // 잔액 열
            if (balanceCell) {
              balanceCell.innerHTML = `<span class="text-yellow-400 font-bold">${newBalance.toLocaleString()} 코인</span>`;

              // 업데이트 효과 추가
              balanceCell.style.background = "rgba(34, 197, 94, 0.2)";
              setTimeout(() => {
                balanceCell.style.background = "";
              }, 1500);
            }
          }
        });
      }

      // admin.html용 금액 포맷팅 함수
      function formatAdminAmount(amount) {
        if (typeof amount !== "number") amount = 0;
        return amount.toLocaleString() + " 코인";
      }

      // 게임 결과 승인 후 자동 데이터 업데이트
      function handleResultApproved() {
        // 베팅 통계 초기화
        const emptyStats = {
          player: { total_bet_amount: 0, bettor_count: 0 },
          banker: { total_bet_amount: 0, bettor_count: 0 },
          tie: { total_bet_amount: 0, bettor_count: 0 },
          player_pair: { total_bet_amount: 0, bettor_count: 0 },
          banker_pair: { total_bet_amount: 0, bettor_count: 0 },
        };
        updateBettingStats(emptyStats);

        // 최근 게임 기록 업데이트
        fetchRecentGames();

        // 사용자 목록 업데이트 (잔액 변경 반영)
        fetchUsers();

        // 베팅 기록 업데이트
        fetchAllBettingHistory();

        // 게임 상태 UI 업데이트
        updateGameControls();

        showToast("게임 결과가 승인되어 모든 데이터가 업데이트되었습니다.");

        // 자동 베팅 모드인 경우 다음 게임 스케줄
        if (autoGameState.isActive) {
          scheduleNextAutoBetting();
        }
      }

      // 게임 상태 관리 수정
      let gameState = {
        isBetting: false,
      };

      // 통합 자동 게임 상태 관리 (자동시작 + 백그라운드 통합)
      let autoGameState = {
        isActive: false,
        gameCount: 0,
        maxGames: 0, // 0이면 무제한 (계속)
      };

      // 게임 상태에 따른 버튼 활성화/비활성화 함수 (통합)
      function updateGameControls() {
        const startButton = document.getElementById("startBetting");
        const autoStartButton = document.getElementById("startAutoGame");
        const autoStopButton = document.getElementById("stopAutoGame");
        const adminStartGameButton = document.getElementById("adminStartGame");

        // 자동 게임 활성화 시 수동 시작 버튼 비활성화
        const isDisabled = gameState.isBetting || autoGameState.isActive;

        startButton.disabled = isDisabled;
        autoStartButton.disabled = isDisabled;

        // 자동 게임 중일 때는 수동 게임 시작 버튼도 비활성화
        if (adminStartGameButton) {
          adminStartGameButton.disabled = isDisabled;
        }

        // 버튼 스타일 업데이트
        if (isDisabled) {
          startButton.classList.add("opacity-50", "cursor-not-allowed");
          autoStartButton.classList.add("opacity-50", "cursor-not-allowed");
          if (adminStartGameButton) {
            adminStartGameButton.classList.add(
              "opacity-50",
              "cursor-not-allowed"
            );
          }
        } else {
          startButton.classList.remove("opacity-50", "cursor-not-allowed");
          autoStartButton.classList.remove("opacity-50", "cursor-not-allowed");
          if (adminStartGameButton) {
            adminStartGameButton.classList.remove(
              "opacity-50",
              "cursor-not-allowed"
            );
          }
        }

        // 자동 게임 버튼 표시/숨김
        if (autoGameState.isActive) {
          autoStartButton.classList.add("hidden");
          autoStopButton.classList.remove("hidden");
        } else {
          autoStartButton.classList.remove("hidden");
          autoStopButton.classList.add("hidden");
        }
      }

      // 자동 게임 시작 함수 (통합)
      function startAutoGame() {
        const gameCountSelect = document.getElementById("autoGameCount");
        const maxGames = parseInt(gameCountSelect.value);

        // 서버에 자동 게임 시작 요청
        socket.emit("start_auto_game", { maxGames });
      }

      // 자동 게임 중지 함수 (통합)
      function stopAutoGame() {
        // 서버에 자동 게임 중지 요청
        socket.emit("stop_auto_game");
      }

      // 자동 상태 표시 업데이트
      function updateAutoStatus(message) {
        const autoStatusEl = document.getElementById("autoStatus");
        if (autoStatusEl) {
          autoStatusEl.classList.remove("hidden");
          autoStatusEl.innerHTML = `${message} <span id="autoProgress"></span>`;
        }
      }

      // 자동 상태 표시 숨김
      function hideAutoStatus() {
        const autoStatusEl = document.getElementById("autoStatus");
        if (autoStatusEl) {
          autoStatusEl.classList.add("hidden");
        }
      }

      // 베팅 시작 버튼 이벤트
      document
        .getElementById("startBetting")
        .addEventListener("click", async () => {
          // 자동 게임 모드일 때는 수동 베팅 시작 방지
          if (autoGameState.isActive) {
            showToast(
              "자동 게임 진행 중에는 수동 베팅을 시작할 수 없습니다.",
              "error"
            );
            return;
          }

          socket.emit("start_betting");
          gameState.isBetting = true;
          updateGameControls();
        });

      // 자동 게임 시작 버튼 이벤트 (통합)
      document.getElementById("startAutoGame").addEventListener("click", () => {
        startAutoGame();
      });

      // 자동 게임 중지 버튼 이벤트 (통합)
      document.getElementById("stopAutoGame").addEventListener("click", () => {
        stopAutoGame();
      });

      // 게임 컨트롤 이벤트 리스너 추가
      document
        .getElementById("adminStartGame")
        .addEventListener("click", () => {
          // 자동 게임 모드일 때는 수동 게임 시작 방지
          if (autoGameState.isActive) {
            showToast(
              "자동 게임 진행 중에는 수동 게임을 시작할 수 없습니다.",
              "error"
            );
            return;
          }

          // 버튼이 이미 비활성화되어 있으면 무시
          const button = document.getElementById("adminStartGame");
          if (button.disabled) {
            return;
          }

          socket.emit("admin_start_game");
          showToast("게임을 시작합니다!");
          button.disabled = true;
        });

      document
        .getElementById("adminShuffleDeck")
        .addEventListener("click", () => {
          socket.emit("admin_shuffle_deck");
          showToast("덱을 셔플합니다!");
        });

      // Socket.io 이벤트 리스너들 (개선된 버전)
      socket.on("betting_status", (status) => {
        gameState.isBetting = status.active;
        updateGameControls();

        // 베팅 상태 표시 업데이트
        const bettingStatusEl = document.getElementById("bettingStatus");
        if (bettingStatusEl) {
          if (status.active) {
            bettingStatusEl.textContent = "현재 상태: 베팅 중";
            bettingStatusEl.className = "text-lg font-semibold text-green-400";
          } else {
            bettingStatusEl.textContent = "현재 상태: 대기중";
            bettingStatusEl.className = "text-lg font-semibold text-yellow-400";
          }
        }

        if (status.stats) {
          updateBettingStats(status.stats);
        }

        // 베팅이 활성화되어 있고 종료 시간이 있으면 타이머 시작
        if (status.active && status.endTime) {
          startTimer(new Date(status.endTime));
        }
      });

      socket.on("betting_started", () => {
        const bettingStatusEl = document.getElementById("bettingStatus");
        if (bettingStatusEl) {
          bettingStatusEl.textContent = "현재 상태: 베팅 중";
          bettingStatusEl.className = "text-lg font-semibold text-green-400";
        }

        // 베팅 통계 초기화 (새로운 임시 베팅 시스템)
        updateBettingStats({
          player: { total_bet_amount: 0, bettor_count: 0 },
          banker: { total_bet_amount: 0, bettor_count: 0 },
          tie: { total_bet_amount: 0, bettor_count: 0 },
          player_pair: { total_bet_amount: 0, bettor_count: 0 },
          banker_pair: { total_bet_amount: 0, bettor_count: 0 },
        });

        gameState.isBetting = true;
        updateGameControls();
      });

      socket.on("betting_end_time", (endTime) => {
        startTimer(new Date(endTime));
      });

      socket.on("betting_closed", () => {
        const bettingStatusEl = document.getElementById("bettingStatus");
        const timerEl = document.getElementById("timer");

        if (bettingStatusEl) {
          bettingStatusEl.textContent = "현재 상태: 베팅 마감";
          bettingStatusEl.className = "text-lg font-semibold text-red-400";
        }

        gameState.isBetting = false;
        updateGameControls();

        if (timerEl) {
          timerEl.textContent = "";
        }

        // 타이머 정리
        if (window.adminCountdownTimer) {
          clearInterval(window.adminCountdownTimer);
        }

        gameState.isBetting = false;
        updateGameControls();

        // 베팅 마감 소리 재생
        const bettingEndSound = document.getElementById("bettingEndSound");
        if (bettingEndSound) {
          bettingEndSound.play().catch((err) => {});
        }

        // 조작 기능을 위해 자동 게임 시작 제거
        // 관리자가 수동으로 "게임 시작" 버튼을 클릭해야 함
      });

      // 새로운 베팅이 들어올 때 실시간 업데이트
      socket.on("new_bet", (data) => {
        if (data.stats) {
          updateBettingStats(data.stats);
        }
      });

      // 베팅 확정 이벤트 핸들러 추가
      socket.on("bets_confirmed", (data) => {
        showToast(
          `베팅이 확정되었습니다. (총 ${data.totalBets}개 베팅)`,
          "success"
        );

        // 베팅 상태 업데이트
        const bettingStatusEl = document.getElementById("bettingStatus");
        if (bettingStatusEl) {
          bettingStatusEl.textContent = "현재 상태: 베팅 확정됨";
          bettingStatusEl.className = "text-lg font-semibold text-green-400";
        }
      });

      // 사용자 잔액 변경 시 실시간 업데이트
      socket.on("user_balance_updated", (data) => {
        if (data.userId && data.newBalance !== undefined) {
          updateUserBalanceInTable(data.userId, data.newBalance);
        }
      });

      // 리더보드 실시간 업데이트
      socket.on("leaderboard_updated", (leaderboard) => {
        updateLeaderboardTable(leaderboard);
      });

      // 게임 결과 승인/거절 후 상태 초기화
      socket.on("result_approved", () => {
        const bettingStatusEl = document.getElementById("bettingStatus");
        if (bettingStatusEl) {
          bettingStatusEl.textContent = "현재 상태: 대기중";
          bettingStatusEl.className = "text-lg font-semibold text-yellow-400";
        }

        // 베팅 통계 초기화
        updateBettingStats({
          player: { total_bet_amount: 0, bettor_count: 0 },
          banker: { total_bet_amount: 0, bettor_count: 0 },
          tie: { total_bet_amount: 0, bettor_count: 0 },
          player_pair: { total_bet_amount: 0, bettor_count: 0 },
          banker_pair: { total_bet_amount: 0, bettor_count: 0 },
        });

        // 게임 시작 버튼 활성화
        document.getElementById("adminStartGame").disabled = false;

        // 사용자 목록과 게임 기록 새로고침
        fetchUsers();
        fetchRecentGames();
        fetchHouseStatistics(); // 하우스 통계도 새로고침

        // 자동 게임 모드에서는 서버에서 자동으로 처리됩니다.
      });

      // 새로운 충전 요청 알림
      socket.on("new_deposit_request", (data) => {
        showToast(
          `💰 새로운 충전 요청: ${
            data.username
          } - ${data.amount.toLocaleString()}코인`,
          "info"
        );
        fetchDepositRequests(); // 충전 요청 목록 새로고침
        fetchFinancialSummary(); // 재정 요약 새로고침
      });

      // 새로운 환전 요청 알림
      socket.on("new_exchange_request", (data) => {
        showToast(
          `💸 새로운 환전 요청: ${
            data.username
          } - ${data.requestAmount.toLocaleString()}코인 (실수령: ${data.actualAmount.toLocaleString()}코인)`,
          "info"
        );
        fetchExchangeRequests(); // 환전 요청 목록 새로고침
        fetchFinancialSummary(); // 재정 요약 새로고침
      });

      // 타이머 시작 함수
      function startTimer(endTime) {
        const timerElement = document.getElementById("timer");
        if (!timerElement) return;

        // 기존 타이머가 있으면 정리
        if (window.adminCountdownTimer) {
          clearInterval(window.adminCountdownTimer);
        }

        window.adminCountdownTimer = setInterval(() => {
          const now = new Date();
          const distance = endTime - now;
          if (distance < 0) {
            clearInterval(window.adminCountdownTimer);
            timerElement.textContent = "";
            return;
          }
          const seconds = Math.floor((distance / 1000) % 60);
          timerElement.innerHTML = `
            <span class="text-2xl font-bold ${
              seconds <= 10 ? "text-red-400 animate-pulse" : "text-blue-400"
            }">
              ${seconds}초
            </span>
          `;
        }, 1000);
      }

      // 하우스 통계 가져오기 함수
      async function fetchHouseStatistics() {
        try {
          const res = await fetch(
            "http://127.0.0.1:5000/api/admin/house-statistics",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (!res.ok) {
            throw new Error("하우스 통계를 불러오는데 실패했습니다.");
          }

          const stats = await res.json();
          updateHouseStatisticsUI(stats);
        } catch (err) {
          console.error("하우스 통계 로드 오류:", err);
          showToast("하우스 통계를 불러오는데 실패했습니다.", "error");
        }
      }

      // 하우스 통계 UI 업데이트 함수
      function updateHouseStatisticsUI(stats) {
        // 전체 통계 업데이트
        const {
          overall,
          financial,
          gameStats,
          betStats,
          period,
          topContributors,
        } = stats;

        // 전체 통계
        document.getElementById(
          "totalBetAmount"
        ).textContent = `${overall.totalBetAmount.toLocaleString()}코인`;
        document.getElementById(
          "totalWinAmount"
        ).textContent = `${overall.totalWinAmount.toLocaleString()}코인`;

        // 베팅 수익
        const bettingHouseProfitEl =
          document.getElementById("bettingHouseProfit");
        if (bettingHouseProfitEl) {
          bettingHouseProfitEl.textContent = `${overall.bettingHouseProfit.toLocaleString()}코인`;
          bettingHouseProfitEl.className = `text-xl font-bold ${
            overall.bettingHouseProfit >= 0 ? "text-green-400" : "text-red-400"
          }`;
        }

        // 실제 순이익
        const realHouseProfitEl = document.getElementById("realHouseProfit");
        if (realHouseProfitEl) {
          realHouseProfitEl.textContent = `${overall.realHouseProfit.toLocaleString()}코인`;
          realHouseProfitEl.className = `text-xl font-bold ${
            overall.realHouseProfit >= 0 ? "text-green-400" : "text-red-400"
          }`;
        }

        // 실제 수익률
        const realProfitMarginEl = document.getElementById("realProfitMargin");
        if (realProfitMarginEl) {
          realProfitMarginEl.textContent = `${overall.realProfitMargin}%`;
        }

        // 충전/환전 통계
        if (financial) {
          const totalDepositEl = document.getElementById("totalDepositAmount");
          if (totalDepositEl)
            totalDepositEl.textContent = `${financial.totalDepositAmount.toLocaleString()}코인`;

          const totalExchangeEl = document.getElementById(
            "totalExchangeAmount"
          );
          if (totalExchangeEl)
            totalExchangeEl.textContent = `${financial.totalExchangeAmount.toLocaleString()}코인`;

          const totalFeesEl = document.getElementById("totalExchangeFees");
          if (totalFeesEl)
            totalFeesEl.textContent = `${financial.totalExchangeFees.toLocaleString()}코인`;

          const totalBalanceEl = document.getElementById("totalUserBalance");
          if (totalBalanceEl)
            totalBalanceEl.textContent = `${financial.totalUserBalance.toLocaleString()}코인`;
        }

        // 기간별 통계 - 오늘
        document.getElementById(
          "todayBetAmount"
        ).textContent = `${period.today.betAmount.toLocaleString()}코인`;
        document.getElementById(
          "todayWinAmount"
        ).textContent = `${period.today.winAmount.toLocaleString()}코인`;

        const todayProfitEl = document.getElementById("todayHouseProfit");
        todayProfitEl.textContent = `${period.today.houseProfit.toLocaleString()}코인`;
        todayProfitEl.className = `font-bold ${
          period.today.houseProfit >= 0 ? "text-green-400" : "text-red-400"
        }`;

        document.getElementById(
          "todayBetCount"
        ).textContent = `${period.today.betCount}회`;

        // 기간별 통계 - 이번 주
        document.getElementById(
          "weekBetAmount"
        ).textContent = `${period.week.betAmount.toLocaleString()}코인`;
        document.getElementById(
          "weekWinAmount"
        ).textContent = `${period.week.winAmount.toLocaleString()}코인`;

        const weekProfitEl = document.getElementById("weekHouseProfit");
        weekProfitEl.textContent = `${period.week.houseProfit.toLocaleString()}코인`;
        weekProfitEl.className = `font-bold ${
          period.week.houseProfit >= 0 ? "text-green-400" : "text-red-400"
        }`;

        document.getElementById(
          "weekBetCount"
        ).textContent = `${period.week.betCount}회`;

        // 게임 결과 통계
        document.getElementById(
          "totalGames"
        ).textContent = `${gameStats.totalGames}회`;
        document.getElementById(
          "playerWinGames"
        ).textContent = `${gameStats.playerWins}회`;
        document.getElementById(
          "bankerWinGames"
        ).textContent = `${gameStats.bankerWins}회`;
        document.getElementById("tieGames").textContent = `${gameStats.ties}회`;

        // 베팅 타입별 통계 업데이트
        updateBetTypeStatistics(betStats);

        // 상위 기여 사용자 업데이트
        updateTopContributors(topContributors);
      }

      // 베팅 타입별 통계 업데이트
      function updateBetTypeStatistics(betStats) {
        const container = document.getElementById("betTypeStats");
        container.innerHTML = "";

        const betTypeNames = {
          player: "플레이어",
          banker: "뱅커",
          tie: "타이",
          player_pair: "플레이어 페어",
          banker_pair: "뱅커 페어",
        };

        const betTypeColors = {
          player: "text-blue-400",
          banker: "text-red-400",
          tie: "text-green-400",
          player_pair: "text-sky-400",
          banker_pair: "text-pink-400",
        };

        Object.entries(betStats).forEach(([betType, stats]) => {
          const div = document.createElement("div");
          div.className = "flex justify-between";

          const profitClass =
            stats.houseProfit >= 0 ? "text-green-400" : "text-red-400";
          const prefix = stats.houseProfit >= 0 ? "+" : "";

          div.innerHTML = `
            <span class="${betTypeColors[betType] || "text-gray-400"}">${
            betTypeNames[betType] || betType
          }:</span>
            <span class="${profitClass} font-bold">${prefix}${stats.houseProfit.toLocaleString()}코인</span>
          `;
          container.appendChild(div);
        });
      }

      // 상위 기여 사용자 업데이트
      function updateTopContributors(contributors) {
        const tableBody = document.getElementById("topContributorsTable");
        tableBody.innerHTML = "";

        if (contributors.length === 0) {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td colspan="5" class="py-4 text-center text-gray-400">
              기여 데이터가 없습니다.
            </td>
          `;
          tableBody.appendChild(tr);
          return;
        }

        contributors.forEach((contributor, index) => {
          const tr = document.createElement("tr");
          tr.className =
            "border-t border-gray-800 hover:bg-gray-700/50 transition-colors";

          const rankClass =
            index < 3
              ? [
                  "text-yellow-400 font-bold",
                  "text-gray-300 font-bold",
                  "text-orange-400 font-bold",
                ][index]
              : "text-gray-400";

          const contributionClass =
            contributor.contribution >= 0 ? "text-green-400" : "text-red-400";
          const contributionPrefix = contributor.contribution >= 0 ? "+" : "";

          tr.innerHTML = `
            <td class="py-3 px-4">
              <span class="${rankClass}">${index + 1}</span>
            </td>
            <td class="py-3 px-4 font-medium">${contributor.username}</td>
            <td class="py-3 px-4 text-right text-yellow-400">${contributor.totalBet.toLocaleString()}코인</td>
            <td class="py-3 px-4 text-right text-blue-400">${contributor.totalWin.toLocaleString()}코인</td>
            <td class="py-3 px-4 text-right ${contributionClass} font-bold">${contributionPrefix}${contributor.contribution.toLocaleString()}코인</td>
          `;
          tableBody.appendChild(tr);
        });
      }

      // 페이지 로드 시 초기화 (개선된 버전)
      document.addEventListener("DOMContentLoaded", () => {
        updateGameControls();
        fetchAllBettingHistory();
        fetchRecentGames();
        fetchUsers(); // 사용자 목록 로드
        fetchExchangeRequests(); // 환전 요청 목록 로드
        fetchFinancialSummary(); // 재정 요약 로드
        fetchDepositRequests(); // 충전 요청 목록 로드
        fetchHouseStatistics(); // 하우스 통계 로드

        // 정기적인 업데이트 설정
        setInterval(() => {
          if (!gameState.isBetting) {
            fetchUsers(); // 베팅 중이 아닐 때만 사용자 목록 새로고침
            fetchFinancialSummary(); // 재정 요약도 업데이트
            fetchHouseStatistics(); // 하우스 통계도 업데이트
          }
          fetchExchangeRequests(); // 환전 요청은 항상 업데이트
          fetchDepositRequests(); // 충전 요청도 항상 업데이트
        }, 30000); // 30초마다
      });

      // 리더보드 테이블 업데이트 함수
      function updateLeaderboardTable(leaderboard) {
        const leaderboardTable = document.getElementById("leaderboardTable");
        if (!leaderboardTable) return;

        leaderboardTable.innerHTML = "";

        leaderboard.forEach((user, index) => {
          const tr = document.createElement("tr");
          tr.className =
            "border-t border-gray-800 hover:bg-gray-800/50 transition-colors";

          const rankClass =
            index < 3
              ? [
                  "text-yellow-400 font-bold",
                  "text-gray-300 font-bold",
                  "text-orange-400 font-bold",
                ][index]
              : "text-gray-400";

          tr.innerHTML = `
            <td class="py-3 px-4">
              <span class="${rankClass}">${index + 1}</span>
            </td>
            <td class="py-3 px-4">${user.username}</td>
            <td class="py-3 px-4 text-right text-yellow-400 font-bold">${user.balance.toLocaleString()} 코인</td>
            <td class="py-3 px-4 text-right">${user.winRate}%</td>
            <td class="py-3 px-4 text-right">${user.totalBets}</td>
          `;
          leaderboardTable.appendChild(tr);
        });
      }

      // 리더보드 가져오기
      async function fetchLeaderboard() {
        try {
          const res = await fetch(
            "http://127.0.0.1:5000/api/admin/leaderboard",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          const leaderboard = await res.json();
          updateLeaderboardTable(leaderboard);
        } catch (err) {
          showToast("리더보드를 불러오는데 실패했습니다.");
        }
      }

      // 전체 베팅 기록 가져오기 함수
      async function fetchAllBettingHistory() {
        try {
          const res = await fetch(
            "http://127.0.0.1:5000/api/admin/all-betting-history",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (!res.ok) {
            throw new Error("베팅 기록을 불러오는데 실패했습다.");
          }

          const allBets = await res.json();
          const container = document.getElementById("allBettingHistoryTable");
          container.innerHTML = "";

          if (allBets.length === 0) {
            container.innerHTML = `
              <tr>
                <td colspan="5" class="py-4 text-center text-gray-400">
                  베팅 록이 없습니다.
                </td>
              </tr>
            `;
            return;
          }

          allBets.forEach((bet) => {
            const tr = document.createElement("tr");
            tr.className = "border-t border-gray-800";

            const resultClass =
              bet.result === "win"
                ? "text-green-400"
                : bet.result === "lose"
                ? "text-red-400"
                : "text-yellow-400";

            const resultText =
              bet.result === "win"
                ? "승리"
                : bet.result === "lose"
                ? "패배"
                : "환급";

            const choiceKorean = {
              player: "플레이어",
              banker: "뱅커",
              tie: "타이",
              player_pair: "플레이어페어",
              banker_pair: "뱅커페어",
            };

            const profitClass =
              bet.profit >= 0 ? "text-green-400" : "text-red-400";
            const profitPrefix = bet.profit >= 0 ? "+" : "";

            tr.innerHTML = `
              <td class="py-3 px-4 text-sm text-gray-400">
                ${new Date(bet.date).toLocaleString()}
              </td>
              <td class="py-3 px-4">${bet.username}</td>
              <td class="py-3 px-4 text-center">
                ${choiceKorean[bet.choice] || bet.choice} → ${
              choiceKorean[bet.gameResult] || bet.gameResult
            }
              </td>
              <td class="py-3 px-4 text-right">
                <span class="text-yellow-400">${bet.amount} 코인</span>
                <span class="${profitClass} ml-2">(${profitPrefix}${
              bet.profit
            } 코인)</span>
              </td>
              <td class="py-3 px-4 text-center">
                <span class="${resultClass} font-semibold">${resultText}</span>
              </td>
            `;
            container.appendChild(tr);
          });
        } catch (err) {
          showToast("베팅 기록을 불러오는데 실패했습니다.");
        }
      }

      // 로그아웃
      document.getElementById("logout").addEventListener("click", () => {
        if (confirm("정말 로그아웃 하시겠습니까?")) {
          localStorage.removeItem("token");
          showToast("로그아웃되었습니다.", "info");
          setTimeout(() => {
            window.location.href = "index.html";
          }, 1000);
        }
      });

      // 최근 게임 기록 표시 함수 수정
      async function fetchRecentGames() {
        try {
          const res = await fetch(
            "http://127.0.0.1:5000/api/admin/recent-games",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (res.status === 403 || res.status === 401) {
            handleAuthError();
            return;
          }

          const recentGames = await res.json();

          // 통계 계산
          const stats = {
            player: 0,
            banker: 0,
            tie: 0,
            total: recentGames.length,
          };

          recentGames.forEach((game) => {
            stats[game.result]++;
          });

          // 통계 업데이트
          document.getElementById("playerWins").textContent = stats.player;
          document.getElementById("bankerWins").textContent = stats.banker;
          document.getElementById("tieWins").textContent = stats.tie;

          // 결과 패턴 표시
          const recentResultsContainer =
            document.getElementById("recentResults");
          recentResultsContainer.innerHTML = "";

          if (recentGames.length === 0) {
            recentResultsContainer.innerHTML = `<div class="text-center text-gray-500 py-4">최근 게임 결과가 없습니다.</div>`;
          } else {
            let currentColumn = null;
            let lastResultType = null;
            // API에서 최근 36개 제한을 걸 수 있지만, 클라이언트에서도 한 번 더 슬라이스하여 최대 표시 개수 관리 (예: 최근 72개로 빅로드 구성)
            const gamesToDisplay = recentGames.slice(-72).reverse(); // 최근 72개로 빅로드 구성, 역순으로 처리해야 올바른 순서로 표시

            gamesToDisplay.forEach((game) => {
              const resultType = game.result;
              let cellText = resultType.charAt(0).toUpperCase();

              if (
                resultType !== lastResultType ||
                !currentColumn ||
                currentColumn.children.length >= 6
              ) {
                currentColumn = document.createElement("div");
                currentColumn.className = "result-column";
                recentResultsContainer.appendChild(currentColumn);
                lastResultType = resultType;
              }

              const resultElement = document.createElement("div");
              resultElement.className = `result-cell ${resultType}`;
              if (game.playerPairOccurred) {
                resultElement.classList.add("player-pair");
              }
              if (game.bankerPairOccurred) {
                resultElement.classList.add("banker-pair");
              }
              // 중국점 스타일이므로 텍스트 없이 색상으로만 표시
              // resultElement.textContent = cellText;
              currentColumn.appendChild(resultElement);
            });
            recentResultsContainer.scrollLeft =
              recentResultsContainer.scrollWidth; // 항상 가장 최근 결과가 보이도록 스크롤
          }

          // 상세 기록 테이블 업데이트
          const recentGamesTable = document.getElementById("recentGamesTable");
          recentGamesTable.innerHTML = "";

          recentGames.forEach((game, index) => {
            const tr = document.createElement("tr");
            tr.className = "hover:bg-gray-800/50 transition-colors";

            const resultText =
              game.result === "player"
                ? "P"
                : game.result === "banker"
                ? "B"
                : "T";

            const resultClass =
              game.result === "player"
                ? "text-blue-400"
                : game.result === "banker"
                ? "text-red-400"
                : "text-green-400";

            tr.innerHTML = `
              <td class="py-1.5 px-2 text-xs">${recentGames.length - index}</td>
              <td class="py-1.5 px-2">
                <span class="font-bold ${resultClass}">${resultText}</span>
              </td>
              <td class="py-1.5 px-2 text-right text-xs">${
                game.playerCount
              }</td>
            `;
            recentGamesTable.appendChild(tr);
          });
        } catch (err) {
          showToast("최근 게임 기록 데터를 러오는 중 오류가 발생했습니다.");
        }
      }

      // 초기 리더보드 로드 (다른 항목들은 DOMContentLoaded에서 처리)
      fetchLeaderboard();

      // 소켓 연결 및 초기 상태 요청
      socket.on("connect", () => {
        socket.emit("authenticate", token);
        // 관리자 페이지에서 현재 베팅 상태 요청
        socket.emit("request_betting_status");
      });

      // 사용자 관리 섹션 수정
      async function fetchUsers() {
        try {
          const res = await fetch(
            "http://127.0.0.1:5000/api/admin/users-stats",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (!res.ok) {
            throw new Error("사용자 데이터를 불러오는데 실패했습니다.");
          }

          const users = await res.json();
          const userTable = document.getElementById("userTable");
          userTable.innerHTML = "";

          users.forEach((user) => {
            const tr = document.createElement("tr");
            tr.className =
              "border-t border-gray-800 hover:bg-gray-700/50 transition-colors";

            // Role and Status styling
            const roleText = user.role === "admin" ? "관리자" : "일반";
            const roleClass =
              user.role === "admin" ? "text-purple-400" : "text-gray-400";
            const approvedText = user.isApproved ? "승인됨" : "미승인";
            const approvedClass = user.isApproved
              ? "text-green-400"
              : "text-yellow-500";

            // Profit/Loss styling
            const netProfit = user.netProfit || 0;
            const netProfitClass =
              netProfit > 0
                ? "text-green-400"
                : netProfit < 0
                ? "text-red-400"
                : "text-gray-400";
            const profitPrefix = netProfit > 0 ? "+" : "";

            // Win rate styling
            const winRate = parseFloat(user.winRate) || 0;
            const winRateClass =
              winRate >= 50
                ? "text-green-400"
                : winRate < 40
                ? "text-red-400"
                : "text-gray-400";

            tr.innerHTML = `
                <td class="py-3 px-4">
                    <div class="font-medium">${user.username}</div>
                    <div class="text-xs ${roleClass}">${roleText}</div>
                </td>
                <td class="py-3 px-4 text-left">
                    <span class="font-medium ${approvedClass}">${approvedText}</span>
                </td>
                <td class="py-3 px-4 text-right">
                    <div class="font-bold text-yellow-400">${user.balance.toLocaleString()} 코인</div>
                </td>
                <td class="py-3 px-4 text-right">
                    <div class="font-medium ${netProfitClass}">${profitPrefix}${netProfit.toLocaleString()} 코인</div>
                </td>
                <td class="py-3 px-4 text-left">
                    <div>
                        <span class="font-medium">${user.wins}승 ${
              user.losses
            }패</span>
                        <span class="text-sm ${winRateClass}">(${winRate.toFixed(
              1
            )}%)</span>
                    </div>
                    <div class="text-xs text-gray-400">총 ${
                      user.totalBets
                    } 베팅</div>
                </td>
                <td class="py-3 px-4">
                    <div class="flex justify-center items-center gap-1 flex-wrap">
                      ${
                        !user.isApproved
                          ? `
                        <button 
                          class="approve-user bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded text-xs font-medium"
                          data-id="${user._id}"
                        >
                          승인
                        </button>
                      `
                          : ""
                      }
                      ${
                        user.role !== "superadmin"
                          ? `
                        <button 
                          onclick="toggleAdmin('${user._id}', '${user.role}')"
                          class="${
                            user.role === "admin"
                              ? "bg-gray-600 hover:bg-gray-700"
                              : "bg-purple-600 hover:bg-purple-700"
                          } text-white px-2 py-1 rounded text-xs font-medium"
                        >
                          ${user.role === "admin" ? "해제" : "지정"}
                        </button>
                      `
                          : ""
                      }
                      <button 
                        class="user-detail bg-yellow-600 hover:bg-yellow-700 text-white px-2 py-1 rounded text-xs font-medium"
                        data-id="${user._id}"
                        data-username="${user.username}"
                      >
                        상세
                      </button>
                      <button 
                        class="reset-password bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-medium"
                        data-id="${user._id}"
                      >
                        비번
                      </button>
                      <button 
                        class="delete-user bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs font-medium"
                        data-id="${user._id}"
                      >
                        삭제
                      </button>
                    </div>
                </td>
            `;
            userTable.appendChild(tr);
          });

          // 이벤트 리스너 설정
          setupUserManagementListeners();
        } catch (err) {
          showToast("사용자 데이터를 불러오는데 실패했습니다.");
        }
      }

      // 사용자 관리 이벤트 리스너 설정
      function setupUserManagementListeners() {
        document.querySelectorAll(".adjust-coins").forEach((button) => {
          button.addEventListener("click", function () {
            const userId = this.getAttribute("data-id");
            adjustCoins(userId);
          });
        });

        document.querySelectorAll(".approve-user").forEach((button) => {
          button.addEventListener("click", function () {
            const userId = this.getAttribute("data-id");
            approveUser(userId);
          });
        });

        document.querySelectorAll(".delete-user").forEach((button) => {
          button.addEventListener("click", function () {
            const userId = this.getAttribute("data-id");
            deleteUser(userId);
          });
        });

        document.querySelectorAll(".reset-password").forEach((button) => {
          button.addEventListener("click", function () {
            const userId = this.getAttribute("data-id");
            resetPassword(userId);
          });
        });

        document.querySelectorAll(".user-detail").forEach((button) => {
          button.addEventListener("click", function () {
            const userId = this.getAttribute("data-id");
            const username = this.getAttribute("data-username");
            showUserDetail(userId, username);
          });
        });
      }

      // 사용자 상세정보 모달 관련 함수들
      let currentDetailUserId = null;

      // 사용자 상세정보 모달 표시
      async function showUserDetail(userId, username) {
        currentDetailUserId = userId;
        document.getElementById("detailUsername").textContent = username;
        document.getElementById("userDetailModal").classList.remove("hidden");

        // 개요 탭을 기본으로 선택
        switchDetailTab("overview");

        // 사용자 상세정보 로드
        await loadUserDetailInfo(userId);
      }

      // 사용자 상세정보 로드
      async function loadUserDetailInfo(userId) {
        try {
          // 기존 users-stats API를 사용하여 해당 사용자 정보 찾기
          const res = await fetch(
            "http://127.0.0.1:5000/api/admin/users-stats",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (!res.ok) {
            throw new Error("사용자 정보를 불러오는데 실패했습니다.");
          }

          const users = await res.json();
          const userDetail = users.find((user) => user._id === userId);

          if (!userDetail) {
            throw new Error("해당 사용자를 찾을 수 없습니다.");
          }

          // 추가 정보를 위해 베팅 기록도 가져오기
          await loadAdditionalUserInfo(userDetail);
          updateUserDetailModal(userDetail);
        } catch (err) {
          showToast("사용자 상세정보를 불러오는데 실패했습니다.", "error");
          console.error("Error loading user detail:", err);
        }
      }

      // 추가 사용자 정보 로드 (베팅 기록 등)
      async function loadAdditionalUserInfo(userDetail) {
        try {
          // 새로운 사용자 상세 정보 API 호출
          const detailRes = await fetch(
            `http://127.0.0.1:5000/api/admin/user-detail/${userDetail._id}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          if (detailRes.ok) {
            const detailData = await detailRes.json();

            // 서버에서 받은 실제 데이터로 업데이트
            userDetail.choicePreferences = detailData.choiceStats;
            userDetail.totalBetAmount = detailData.totalBetAmount; // 실제 베팅액 100%
            userDetail.totalWinAmount = detailData.totalWinAmount;
            userDetail.averageBetAmount = detailData.averageBetAmount;
            userDetail.bettingProfit = detailData.bettingProfit;

            // 롤링 정보 (실제 서버 데이터)
            userDetail.rollingWageredAmount = detailData.rollingWagered; // 실제 베팅액
            userDetail.rollingRequiredAmount = detailData.rollingRequirement; // 롤링 요구량
            userDetail.rollingProgress = detailData.rollingProgress; // 롤링 진행률

            // 재정 정보
            userDetail.totalDeposited = detailData.totalDeposited;
            userDetail.totalExchanged = detailData.totalExchanged;
            userDetail.depositCount = detailData.depositCount;
            userDetail.exchangeCount = detailData.exchangeCount;
            userDetail.overallProfit = detailData.overallProfit;
            userDetail.recentTransactions = detailData.recentTransactions;
          }
        } catch (err) {
          console.error("Error loading additional user info:", err);
          // 기본값 설정
          userDetail.choicePreferences = {};
          userDetail.totalBetAmount = 0;
          userDetail.totalWinAmount = 0;
          userDetail.averageBetAmount = 0;
          userDetail.bettingProfit = 0;
          userDetail.rollingWageredAmount = 0;
          userDetail.rollingRequiredAmount = 0;
          userDetail.rollingProgress = 0;
          userDetail.overallProfit = userDetail.netProfit || 0;
          userDetail.totalDeposited = 0;
          userDetail.totalExchanged = 0;
          userDetail.depositCount = 0;
          userDetail.exchangeCount = 0;
          userDetail.recentTransactions = [];
        }
      }

      // 사용자 상세정보 모달 업데이트
      function updateUserDetailModal(userDetail) {
        // 개요 탭 정보 업데이트
        document.getElementById("detailUserWins").textContent =
          parseInt(userDetail.wins) || 0;
        document.getElementById("detailUserLoses").textContent =
          parseInt(userDetail.losses) || 0;
        document.getElementById("detailUserWinRate").textContent = `${(
          parseFloat(userDetail.winRate) || 0
        ).toFixed(1)}%`;
        document.getElementById("detailTotalGames").textContent =
          parseInt(userDetail.totalBets) || 0;

        const bettingProfit = parseFloat(userDetail.bettingProfit) || 0;
        const bettingProfitElement = document.getElementById(
          "detailGameStatsBettingProfit"
        );
        bettingProfitElement.textContent = `${
          bettingProfit >= 0 ? "+" : ""
        }${Math.round(bettingProfit).toLocaleString()}코인`;
        bettingProfitElement.className = `font-bold text-lg ${
          bettingProfit >= 0 ? "text-green-400" : "text-red-400"
        }`;

        document.getElementById("detailCurrentBalance").textContent = `${(
          parseInt(userDetail.balance) || 0
        ).toLocaleString()}코인`;

        const overallProfit = parseFloat(userDetail.overallProfit) || 0;
        const overallProfitElement = document.getElementById(
          "detailOverallProfit"
        );
        overallProfitElement.textContent = `${
          overallProfit >= 0 ? "+" : ""
        }${Math.round(overallProfit).toLocaleString()}코인`;
        overallProfitElement.className = `font-bold text-lg ${
          overallProfit >= 0 ? "text-green-400" : "text-red-400"
        }`;

        // 베팅 분석 탭 정보 업데이트
        document.getElementById("detailModalTotalBetAmount").textContent = `${(
          parseInt(userDetail.totalBetAmount) || 0
        ).toLocaleString()}코인`;
        document.getElementById("detailModalTotalWinAmount").textContent = `${(
          parseInt(userDetail.totalWinAmount) || 0
        ).toLocaleString()}코인`;

        const modalBettingProfit = parseFloat(userDetail.bettingProfit) || 0;
        const modalBettingProfitElement = document.getElementById(
          "detailModalBettingProfit"
        );
        modalBettingProfitElement.textContent = `${
          modalBettingProfit >= 0 ? "+" : ""
        }${Math.round(modalBettingProfit).toLocaleString()}코인`;
        modalBettingProfitElement.className = `font-bold ${
          modalBettingProfit >= 0 ? "text-green-400" : "text-red-400"
        }`;

        document.getElementById(
          "detailModalAverageBetAmount"
        ).textContent = `${Math.round(
          parseFloat(userDetail.averageBetAmount) || 0
        ).toLocaleString()}코인`;

        // 베팅 선호도 업데이트
        updateDetailChoicePreferences(userDetail.choicePreferences || {});

        // 롤링 정보 업데이트
        const rollingProgress = parseFloat(userDetail.rollingProgress) || 0;
        document.getElementById(
          "detailRollingProgressTextInfo"
        ).textContent = `${rollingProgress.toFixed(1)}%`;
        document.getElementById(
          "detailRollingProgressBarInfo"
        ).style.width = `${Math.min(rollingProgress, 100)}%`;
        document.getElementById("detailRollingWageredAmount").textContent = `${(
          parseInt(userDetail.rollingWageredAmount) || 0
        ).toLocaleString()}코인`;
        document.getElementById(
          "detailRollingRequiredAmount"
        ).textContent = `${(
          parseInt(userDetail.rollingRequiredAmount) || 0
        ).toLocaleString()}코인`;

        // 재정 현황 탭 정보 업데이트
        document.getElementById("detailTotalDeposited").textContent = `${(
          parseInt(userDetail.totalDeposited) || 0
        ).toLocaleString()}코인`;
        document.getElementById("detailDepositCount").textContent =
          parseInt(userDetail.depositCount) || 0;
        document.getElementById("detailTotalExchanged").textContent = `${(
          parseInt(userDetail.totalExchanged) || 0
        ).toLocaleString()}코인`;
        document.getElementById("detailExchangeCount").textContent =
          parseInt(userDetail.exchangeCount) || 0;

        // 최근 거래 내역 업데이트
        updateDetailRecentTransactions(userDetail.recentTransactions || []);
      }

      // 베팅 선호도 차트 업데이트
      function updateDetailChoicePreferences(preferences) {
        const container = document.getElementById("detailChoicePreferences");
        container.innerHTML = "";

        const choiceNames = {
          player: "플레이어",
          banker: "뱅커",
          tie: "타이",
          player_pair: "플레이어 페어",
          banker_pair: "뱅커 페어",
        };

        const choiceColors = {
          player: "bg-blue-500",
          banker: "bg-red-500",
          tie: "bg-green-500",
          player_pair: "bg-blue-400",
          banker_pair: "bg-red-400",
        };

        let maxCount = 0;
        let favoriteChoice = "-";
        let maxChoiceKey = "";

        // 최대값과 선호 베팅 찾기
        Object.entries(preferences).forEach(([choice, count]) => {
          if (count > maxCount) {
            maxCount = count;
            favoriteChoice = choiceNames[choice] || choice;
            maxChoiceKey = choice;
          }
        });

        // 차트 생성
        Object.entries(preferences).forEach(([choice, count]) => {
          const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
          const choiceName = choiceNames[choice] || choice;
          const colorClass = choiceColors[choice] || "bg-gray-500";

          const div = document.createElement("div");
          div.className = "flex items-center space-x-2";
          div.innerHTML = `
            <span class="text-sm text-gray-400 w-20">${choiceName}:</span>
            <div class="flex-1 bg-gray-700 rounded-full h-2">
              <div class="${colorClass} h-2 rounded-full" style="width: ${percentage}%"></div>
            </div>
            <span class="text-sm text-gray-300 w-8">${count}</span>
          `;
          container.appendChild(div);
        });

        document.getElementById("detailFavoriteChoice").textContent =
          favoriteChoice;
      }

      // 최근 거래 내역 업데이트
      function updateDetailRecentTransactions(transactions) {
        const container = document.getElementById("detailRecentTransactions");
        container.innerHTML = "";

        if (transactions.length === 0) {
          container.innerHTML =
            '<div class="text-gray-400 text-center py-4">거래 내역이 없습니다.</div>';
          return;
        }

        transactions.forEach((transaction) => {
          const div = document.createElement("div");
          div.className = "bg-black bg-opacity-30 p-3 rounded-lg";

          const typeText = transaction.type === "deposit" ? "충전" : "환전";
          const typeColor =
            transaction.type === "deposit"
              ? "text-blue-400"
              : "text-orange-400";
          const statusText =
            transaction.status === "approved"
              ? "승인"
              : transaction.status === "pending"
              ? "대기"
              : "거절";
          const statusColor =
            transaction.status === "approved"
              ? "text-green-400"
              : transaction.status === "pending"
              ? "text-yellow-400"
              : "text-red-400";

          div.innerHTML = `
            <div class="flex justify-between items-center">
              <div>
                <span class="${typeColor} font-medium">${typeText}</span>
                <span class="text-gray-400 text-sm ml-2">${new Date(
                  transaction.createdAt
                ).toLocaleDateString()}</span>
              </div>
              <div class="text-right">
                <div class="font-bold">${transaction.amount.toLocaleString()}코인</div>
                <div class="${statusColor} text-sm">${statusText}</div>
              </div>
            </div>
          `;
          container.appendChild(div);
        });
      }

      // 상세정보 모달 탭 전환
      function switchDetailTab(tabName) {
        // 모든 탭 버튼 비활성화
        document
          .querySelectorAll('[id^="detail"][id$="Tab"]')
          .forEach((tab) => {
            tab.className =
              "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors text-gray-400 hover:text-yellow-500";
          });

        // 모든 탭 컨텐츠 숨기기
        document
          .querySelectorAll('[id^="detail"][id$="Content"]')
          .forEach((content) => {
            content.classList.add("hidden");
          });

        // 선택된 탭 활성화
        const activeTab = document.getElementById(
          `detail${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Tab`
        );
        const activeContent = document.getElementById(
          `detail${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Content`
        );

        if (activeTab && activeContent) {
          activeTab.className =
            "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors bg-purple-600 text-white";
          activeContent.classList.remove("hidden");
        }
      }

      // resetPassword 함수 수정
      async function resetPassword(userId) {
        const newPassword = prompt("새 비밀번호를 입력하세요:");
        if (!newPassword) return;

        try {
          const res = await fetch(
            `http://127.0.0.1:5000/api/admin/users/${userId}/reset-password`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ newPassword }),
            }
          );

          const data = await res.json();
          showToast(data.message);
          if (res.ok) {
            fetchUsers(); // 목록 새로고침
          }
        } catch (err) {
          showToast("서버 에러가 발생했습니다.");
        }
      }

      // adjustCoins 함수 수정 (모달 사용으로 개선)
      async function adjustCoins(userId) {
        return new Promise((resolve) => {
          // 모달 생성
          const modal = document.createElement("div");
          modal.className =
            "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50";
          modal.innerHTML = `
            <div class="bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
              <h3 class="text-lg font-semibold text-white mb-4">잔액 조정</h3>
              <div class="mb-4">
                <label class="block text-gray-300 text-sm font-medium mb-2">
                  조정할 금액(코인)을 입력하세요 (음수 가능):
                </label>
                <input 
                  type="number" 
                  id="adjustmentAmount" 
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  step="1"
                />
              </div>
              <div class="flex space-x-3">
                <button 
                  id="confirmAdjust" 
                  class="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
                >
                  확인
                </button>
                <button 
                  id="cancelAdjust" 
                  class="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          `;

          document.body.appendChild(modal);

          const input = modal.querySelector("#adjustmentAmount");
          const confirmBtn = modal.querySelector("#confirmAdjust");
          const cancelBtn = modal.querySelector("#cancelAdjust");

          // 입력 필드에 포커스
          input.focus();

          // Enter 키로 확인
          input.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
              confirmBtn.click();
            }
          });

          // 확인 버튼 클릭
          confirmBtn.addEventListener("click", async () => {
            const amount = input.value.trim();
            if (!amount) {
              showToast("금액을 입력해주세요.", "error");
              return;
            }

            const adjustment = parseInt(amount);
            if (isNaN(adjustment)) {
              showToast("유효한 숫자를 입력해주세요.", "error");
              return;
            }

            try {
              const res = await fetch(
                `http://127.0.0.1:5000/api/admin/users/${userId}/adjust-coins`,
                {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ adjustment }),
                }
              );

              const data = await res.json();
              showToast(data.message);
              if (res.ok) {
                // 실시간 업데이트: 특정 사용자 잔액만 업데이트
                if (data.newBalance !== undefined) {
                  updateUserBalanceInTable(userId, data.newBalance);
                } else {
                  fetchUsers(); // 실시간 업데이트가 안 되면 전체 새로고침
                }
              }
            } catch (err) {
              showToast("서버 에러가 발생했습니다.", "error");
            }

            // 모달 제거
            document.body.removeChild(modal);
            resolve();
          });

          // 취소 버튼 클릭
          cancelBtn.addEventListener("click", () => {
            document.body.removeChild(modal);
            resolve();
          });

          // 모달 외부 클릭시 닫기
          modal.addEventListener("click", (e) => {
            if (e.target === modal) {
              document.body.removeChild(modal);
              resolve();
            }
          });

          // ESC 키로 닫기
          const handleEscape = (e) => {
            if (e.key === "Escape") {
              document.removeEventListener("keydown", handleEscape);
              document.body.removeChild(modal);
              resolve();
            }
          };
          document.addEventListener("keydown", handleEscape);
        });
      }

      // 게임 기록 초기화 함수 추가
      async function resetGameHistory() {
        if (
          !confirm(
            "정말로 모든 게임 기록을 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다."
          )
        ) {
          return;
        }

        try {
          const res = await fetch(
            "http://127.0.0.1:5000/api/admin/reset-game-history",
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${token}`,
              },
            }
          );

          if (res.ok) {
            showToast("게임 기록이 초기화되었니다.");
            // 통계와 테이블 새로고침
            fetchRecentGames();
          } else {
            showToast("게임 기록 초기화에 실패했습니다.");
          }
        } catch (err) {
          showToast("서버 에러가 발생했습니다.");
        }
      }

      // 환전 요청 목록 가져오기 함수 수정
      async function fetchExchangeRequests() {
        try {
          const res = await fetch(
            "http://127.0.0.1:5000/api/admin/exchange-requests",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          const requests = await res.json();
          const container = document.getElementById("exchangeRequestsTable");
          container.innerHTML = "";

          requests.forEach((request) => {
            const tr = document.createElement("tr");
            tr.className = "border-t border-gray-800";

            const statusClass = {
              pending: "text-yellow-400",
              approved: "text-green-400",
              rejected: "text-red-400",
            }[request.status];

            const statusText = {
              pending: "대기중",
              approved: "승인됨",
              rejected: "거절됨",
            }[request.status];

            tr.innerHTML = `
              <td class="py-3 px-4">${new Date(
                request.createdAt
              ).toLocaleString()}</td>
              <td class="py-3 px-4">${request.username}</td>
              <td class="py-3 px-4 text-right text-yellow-400">${request.requestAmount.toLocaleString()} 코인</td>
              <td class="py-3 px-4 text-right">
                <div class="text-green-400">실수령: ${request.actualAmount.toLocaleString()} 코인</div>
                <div class="text-red-400">수수료: ${request.fee.toLocaleString()} 코인</div>
              </td>
              <td class="py-3 px-4 text-center">
                <span class="${statusClass} font-semibold">${statusText}</span>
              </td>
              <td class="py-3 px-4 text-center">
                ${
                  request.status === "pending"
                    ? `
                  <button 
                    onclick="handleExchange('${request._id}', 'approved')"
                    class="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded mr-2"
                  >
                    승인
                  </button>
                  <button 
                    onclick="handleExchange('${request._id}', 'rejected')"
                    class="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded"
                  >
                    거절
                  </button>
                `
                    : ""
                }
              </td>
            `;
            container.appendChild(tr);
          });
        } catch (err) {
          showToast("환전 요청 목록을 불러오는데 실패했습니다.");
        }
      }

      // 환전 요청 처리
      async function handleExchange(requestId, status) {
        if (
          !confirm(
            `정말로 이 환전 요청을 ${
              status === "approved" ? "승인" : "거절"
            }하시겠습니?`
          )
        ) {
          return;
        }

        try {
          const res = await fetch(
            `http://127.0.0.1:5000/api/admin/exchange-requests/${requestId}`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ status }),
            }
          );

          const data = await res.json();
          showToast(data.message);

          if (res.ok) {
            fetchExchangeRequests(); // 목록 새로고침
            fetchFinancialSummary(); // 재정 요약 새로고침
          }
        } catch (err) {
          showToast("서버 에러가 발생했습니다.");
        }
      }

      // 환전 요청 목록은 DOMContentLoaded에서 처리됨

      // Socket.IO 이벤트 리스너 추가

      // 기존 game.html 호환용 game_result 이벤트 (새로운 admin 컨트롤 시스템이 우선)
      socket.on("game_result", (data) => {
        // 이 핸들러의 내용은 서버에서 결과가 자동으로 처리되므로 제거합니다.
        // 게임 결과 표시는 game_result_with_cards 핸들러에서 처리됩니다.
      });

      // 페이지 로드 시 결과 관리 섹션 숨기기
      document.addEventListener("DOMContentLoaded", () => {});

      // Socket.IO 이벤트 리스너 수정
      socket.on("recent_games_updated", (data) => {
        const { recentGames, stats: gameStats } = data; // 서버에서 오는 stats는 게임 승리 통계이므로 gameStats로 변경
        // updateGameStats(recentGames, gameStats); // 이 함수는 이제 최근 게임 '목록' 통계를 다룸. 베팅 통계와는 다름.
        // fetchRecentGames 함수 내부에서 통계 업데이트가 이미 처리되고 있음.
        // 만약 여기서도 최근 게임 목록에 대한 통계를 표시해야 한다면, 해당 로직을 여기에 유지.

        // 최근 게임 기록 테이블 업데이트
        const recentGamesTable = document.getElementById("recentGamesTable");
        if (recentGamesTable) {
          recentGamesTable.innerHTML = "";

          recentGames.forEach((game, index) => {
            const tr = document.createElement("tr");
            tr.className = "border-t border-gray-800";

            const resultClass = {
              player: "text-blue-400",
              banker: "text-red-400",
              tie: "text-green-400",
            }[game.result];

            const resultText =
              game.result === "player"
                ? "플레이어"
                : game.result === "banker"
                ? "뱅커"
                : "타이";

            tr.innerHTML = `
              <td class="py-3 px-4">${recentGames.length - index}</td>
              <td class="py-3 px-4">
                 <span class="font-semibold ${resultClass}">${resultText}</span>
              </td>
              <td class="py-3 px-4">${new Date(game.date).toLocaleString()}</td>
              <td class="py-3 px-4 text-right">${formatAdminAmount(
                game.totalBets
              )}</td>
              <td class="py-3 px-4 text-right">${game.playerCount}명</td>
              <td class="py-3 px-4 text-center">${
                game.playerPairOccurred
                  ? '<span class="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-500 text-white">P</span>'
                  : "-"
              }</td>
              <td class="py-3 px-4 text-center">${
                game.bankerPairOccurred
                  ? '<span class="text-xs font-semibold px-1.5 py-0.5 rounded bg-red-500 text-white">B</span>'
                  : "-"
              }</td>
            `;
            recentGamesTable.appendChild(tr);
          });
        }

        // "최근 게임 기록" 섹션의 전체 통계 업데이트 (P/B/T 승리 횟수 등)
        if (gameStats) {
          document.getElementById("playerWins").textContent =
            gameStats.playerWins || 0;
          document.getElementById("bankerWins").textContent =
            gameStats.bankerWins || 0;
          document.getElementById("tieWins").textContent = gameStats.ties || 0;
        }
      });

      // 실시간 베팅 현황 업데이트 (new_bet 이벤트 핸들러)
      socket.on("new_bet", (data) => {
        const { stats } = data;
        if (stats) {
          // stats 객체가 존재하는지 확인
          updateBettingStats(stats); // 실시간 베팅 현황 업데이트 함수 호출
        }
      });

      // 결과 승인 완료 알림 처리
      socket.on("admin_result_approved", (data) => {
        showToast(`✅ ${data.message}`, 3000);

        // 자동 새로고침 대신 실시간 업데이트 확인
        setTimeout(() => {
          // 추가적인 데이터 동기화가 필요한 경우 여기서 처리
          fetchUsers();
          fetchAllBettingHistory();
          fetchHouseStatistics(); // 하우스 통계도 업데이트
        }, 500);
      });

      // 게임 결과 수신 이벤트 (실시간 점수)
      socket.on("game_result", (data) => {
        const { result, playerScore, bankerScore } = data;

        // 승자 표시
        const gameWinner = document.getElementById("gameWinner");
        let winnerText = "";
        let winnerClass = "";

        if (result === "player") {
          winnerText = `플레이어 승리! (${playerScore}-${bankerScore})`;
          winnerClass = "text-blue-400";
        } else if (result === "banker") {
          winnerText = `뱅커 승리! (${playerScore}-${bankerScore})`;
          winnerClass = "text-red-400";
        } else {
          winnerText = `타이! (${playerScore}-${bankerScore})`;
          winnerClass = "text-green-400";
        }

        gameWinner.textContent = winnerText;
        gameWinner.className = `text-xl font-bold text-center mb-2 ${winnerClass}`;
      });

      // 게임 결과 수신 이벤트 (카드 정보 포함)
      socket.on("game_result_with_cards", (gameData) => {
        // 카드 정보 표시
        displayCards("playerCards", gameData.playerHand);
        displayCards("bankerCards", gameData.bankerHand);

        // 점수 표시
        document.getElementById(
          "playerScore"
        ).textContent = `${gameData.playerHand.calculation} = ${gameData.playerScore}`;
        document.getElementById(
          "bankerScore"
        ).textContent = `${gameData.bankerHand.calculation} = ${gameData.bankerScore}`;

        // 승자 표시 (점수 포함)
        const gameWinner = document.getElementById("gameWinner");
        let winnerText = "";
        let winnerClass = "";

        if (gameData.result === "player") {
          winnerText = `플레이어 승리! (${gameData.playerScore}-${gameData.bankerScore})`;
          winnerClass = "text-blue-400";
        } else if (gameData.result === "banker") {
          winnerText = `뱅커 승리! (${gameData.playerScore}-${gameData.bankerScore})`;
          winnerClass = "text-red-400";
        } else {
          winnerText = `타이! (${gameData.playerScore}-${gameData.bankerScore})`;
          winnerClass = "text-green-400";
        }

        gameWinner.textContent = winnerText;
        gameWinner.className = `text-xl font-bold text-center mb-2 ${winnerClass}`;

        // 페어 결과 표시
        const pairResults = document.getElementById("pairResults");
        let pairText = "";
        if (gameData.playerPairOccurred || gameData.bankerPairOccurred) {
          const pairs = [];
          if (gameData.playerPairOccurred) pairs.push("플레이어 페어");
          if (gameData.bankerPairOccurred) pairs.push("뱅커 페어");
          pairText = `${pairs.join(", ")} 발생!`;
        } else {
          pairText = "페어 없음";
        }
        pairResults.textContent = pairText;

        // 덱 정보 업데이트
        updateDeckInfo(gameData.deckInfo);

        // 게임 시작 버튼 활성화
        document.getElementById("adminStartGame").disabled = false;

        showToast("게임 결과가 생성되었습니다!");
      });

      // 덱 셔플 완료 이벤트
      socket.on("deck_shuffled", (data) => {
        showToast(data.message);
        updateDeckInfo(data.deckInfo);
      });

      // 덱 정보 수신 이벤트
      socket.on("deck_info", (deckInfo) => {
        updateDeckInfo(deckInfo);
      });

      // 자동 게임 관련 소켓 이벤트들 (통합)
      socket.on("auto_game_started", (data) => {
        autoGameState.isActive = true;
        autoGameState.gameCount = data.gameCount;
        autoGameState.maxGames = data.maxGames;
        updateGameControls();

        const gameTypeText =
          data.maxGames === 0 ? "무제한" : `${data.maxGames}회`;
        updateAutoStatus(`자동 게임 진행 중 (${gameTypeText})`);
        showToast(data.message, "success");
      });

      socket.on("auto_game_status", (data) => {
        autoGameState.isActive = data.isActive;
        autoGameState.gameCount = data.gameCount;
        autoGameState.maxGames = data.maxGames;

        if (data.isActive) {
          const gameTypeText =
            data.maxGames === 0 ? "무제한" : `${data.maxGames}회`;
          const progressText =
            data.maxGames === 0
              ? `${data.gameCount}회 진행`
              : `${data.gameCount}/${data.maxGames}`;
          updateAutoStatus(`자동 게임 진행 중 (${gameTypeText})`);

          const progressEl = document.getElementById("autoProgress");
          if (progressEl) {
            progressEl.textContent = `(${progressText})`;
          }
        } else {
          hideAutoStatus();
        }
        updateGameControls();
      });

      socket.on("auto_game_stopped", (data) => {
        autoGameState.isActive = false;
        autoGameState.gameCount = 0;
        autoGameState.maxGames = 0;
        updateGameControls();
        hideAutoStatus();
        showToast(data.message, "info");
      });

      // 페이지 로드 시 자동 게임 상태 확인
      socket.on("connect", () => {
        // 소켓 인증 (토큰 전송)
        socket.emit("authenticate", token);
        // 자동 게임 상태 요청
        socket.emit("get_auto_game_status");
      });

      // 실시간 카드 표시 이벤트 (카드 하나씩 받아오기)
      socket.on("card_dealt_to_user_ui", (data) => {
        const { target, cardValue, cardSuit, cardIndex, isNewHand } = data;

        // 새로운 핸드 시작 시 카드 클리어
        if (isNewHand && cardIndex === 0) {
          if (target === "player") {
            document.getElementById("playerCards").innerHTML = "";
            document.getElementById("playerScore").textContent = "";
          } else if (target === "banker") {
            document.getElementById("bankerCards").innerHTML = "";
            document.getElementById("bankerScore").textContent = "";
          }
        }

        // 카드 표시
        displaySingleCard(target, cardValue, cardSuit, cardIndex);
      });

      // 카드 클리어 이벤트
      socket.on("clear_cards_display_on_user_html", () => {
        // 모든 카드와 점수 클리어
        document.getElementById("playerCards").innerHTML =
          '<span class="text-gray-500 text-sm">카드가 없습니다</span>';
        document.getElementById("bankerCards").innerHTML =
          '<span class="text-gray-500 text-sm">카드가 없습니다</span>';
        document.getElementById("playerScore").textContent = "";
        document.getElementById("bankerScore").textContent = "";

        // 게임 결과도 초기화
        const gameWinner = document.getElementById("gameWinner");
        if (gameWinner) {
          gameWinner.textContent = "게임 결과 대기 중...";
          gameWinner.className =
            "text-base font-bold text-center mb-1 text-gray-500";
        }

        const pairResults = document.getElementById("pairResults");
        if (pairResults) {
          pairResults.textContent = "";
        }
      });

      // 카드 표시 함수 (전체 핸드)
      function displayCards(containerId, handData) {
        const container = document.getElementById(containerId);
        container.innerHTML = "";

        handData.cards.forEach((card, index) => {
          const cardDiv = document.createElement("div");
          cardDiv.className =
            "inline-block mr-2 mb-1 px-2 py-1 bg-white text-black rounded text-sm font-bold";

          // 카드 값 변환 (0을 10으로 표시)
          let displayValue = card.value;
          if (card.value === "0") displayValue = "10";

          // 슈트 이모지 (서버의 H, D, C, S 형식에 맞춤)
          const suitEmoji = {
            H: "♥️", // Hearts
            D: "♦️", // Diamonds
            C: "♣️", // Clubs
            S: "♠️", // Spades
          };

          cardDiv.textContent = `${displayValue}${suitEmoji[card.suit] || ""}`;

          // 빨간색 카드는 빨간 텍스트로
          if (card.suit === "H" || card.suit === "D") {
            cardDiv.className += " text-red-600";
          }

          container.appendChild(cardDiv);
        });
      }

      // 개별 카드 표시 함수 (실시간용)
      function displaySingleCard(target, cardValue, cardSuit, cardIndex) {
        const containerId = target === "player" ? "playerCards" : "bankerCards";
        const container = document.getElementById(containerId);

        if (!container) return;

        const cardDiv = document.createElement("div");
        cardDiv.className =
          "inline-block mr-2 mb-1 px-2 py-1 bg-white text-black rounded text-sm font-bold";

        // 카드 값 변환
        let displayValue = cardValue;
        if (cardValue === "0") displayValue = "10";

        // 슈트 이모지
        const suitEmoji = {
          H: "♥️", // Hearts
          D: "♦️", // Diamonds
          C: "♣️", // Clubs
          S: "♠️", // Spades
        };

        cardDiv.textContent = `${displayValue}${suitEmoji[cardSuit] || ""}`;

        // 빨간색 카드는 빨간 텍스트로
        if (cardSuit === "H" || cardSuit === "D") {
          cardDiv.className += " text-red-600";
        }

        // 애니메이션 효과 추가
        cardDiv.style.opacity = "0";
        cardDiv.style.transform = "scale(0.8)";

        container.appendChild(cardDiv);

        // 애니메이션 실행
        setTimeout(() => {
          cardDiv.style.transition = "all 0.3s ease-out";
          cardDiv.style.opacity = "1";
          cardDiv.style.transform = "scale(1)";
        }, 50);
      }

      // 덱 정보 업데이트 함수
      function updateDeckInfo(deckInfo) {
        const deckInfoElement = document.getElementById("deckInfo");
        if (deckInfoElement && deckInfo) {
          deckInfoElement.textContent = `남은 카드: ${deckInfo.remainingCards}장 (${deckInfo.remainingDecks}덱)`;
        }
      }

      // 페이지 로드 시 덱 정보 요청
      document.addEventListener("DOMContentLoaded", () => {
        socket.emit("get_deck_info");

        // 사용자 상세정보 모달 이벤트 리스너
        document
          .getElementById("closeUserDetail")
          .addEventListener("click", function () {
            document.getElementById("userDetailModal").classList.add("hidden");
          });

        // 상세정보 모달 탭 이벤트 리스너
        document
          .getElementById("detailOverviewTab")
          .addEventListener("click", function () {
            switchDetailTab("overview");
          });

        document
          .getElementById("detailBettingTab")
          .addEventListener("click", function () {
            switchDetailTab("betting");
          });

        document
          .getElementById("detailFinancialTab")
          .addEventListener("click", function () {
            switchDetailTab("financial");
          });

        // 모달 외부 클릭시 닫기
        document
          .getElementById("userDetailModal")
          .addEventListener("click", function (e) {
            if (e.target === this) {
              this.classList.add("hidden");
            }
          });
      });

      // 재정 요약 가져오기 함수
      async function fetchFinancialSummary() {
        try {
          const res = await fetch(
            "http://127.0.0.1:5000/api/admin/users-financial-summary",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          if (!res.ok)
            throw new Error("재정 요약 데이터를 불러오는데 실패했습니다.");

          const summaries = await res.json();
          const tableBody = document.getElementById("financialSummaryTable");
          tableBody.innerHTML = "";

          summaries.forEach((summary) => {
            const tr = document.createElement("tr");
            tr.className =
              "border-t border-gray-800 hover:bg-gray-700/50 transition-colors";

            const profitClass =
              summary.financialProfit > 0
                ? "text-green-400"
                : summary.financialProfit < 0
                ? "text-red-400"
                : "text-gray-400";

            tr.innerHTML = `
              <td class="py-3 px-4 font-medium">${summary.username}</td>
              <td class="py-3 px-4 text-right text-yellow-400 font-bold">${summary.currentBalance.toLocaleString()} 코인</td>
              <td class="py-3 px-4 text-right text-blue-400">${summary.totalDeposited.toLocaleString()} 코인</td>
              <td class="py-3 px-4 text-right text-orange-400">${summary.totalExchanged.toLocaleString()} 코인</td>
              <td class="py-3 px-4 text-right ${profitClass} font-semibold">${summary.financialProfit.toLocaleString()} 코인</td>
              <td class="py-3 px-4 text-center">
                <button 
                  class="adjust-coins bg-yellow-600 hover:bg-yellow-700 text-white px-2.5 py-1.5 rounded text-sm font-medium transition-colors"
                  data-id="${summary.userId}"
                >
                  잔액 조절
                </button>
              </td>
            `;
            tableBody.appendChild(tr);
          });

          // 잔액 조절 버튼에 이벤트 리스너 추가
          document
            .querySelectorAll("#financialSummaryTable .adjust-coins")
            .forEach((button) => {
              button.addEventListener("click", function () {
                const userId = this.getAttribute("data-id");
                adjustCoins(userId);
              });
            });
        } catch (err) {
          showToast(err.message);
        }
      }

      // 충전 요청 목록 가져오기 함수
      async function fetchDepositRequests() {
        try {
          const res = await fetch(
            "http://127.0.0.1:5000/api/admin/deposit-requests",
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          const requests = await res.json();
          const container = document.getElementById("depositRequestsTable");
          container.innerHTML = "";

          requests.forEach((request) => {
            const tr = document.createElement("tr");
            tr.className = "border-t border-gray-800";

            const statusClass = {
              pending: "text-yellow-400",
              approved: "text-green-400",
              rejected: "text-red-400",
            }[request.status];

            const statusText = {
              pending: "대기중",
              approved: "승인됨",
              rejected: "거절됨",
            }[request.status];

            tr.innerHTML = `
              <td class="py-3 px-4">${new Date(
                request.createdAt
              ).toLocaleString()}</td>
              <td class="py-3 px-4">${request.username}</td>
              <td class="py-3 px-4 text-right text-yellow-400">${request.amount.toLocaleString()} 코인</td>
              <td class="py-3 px-4 text-center">
                <span class="${statusClass} font-semibold">${statusText}</span>
              </td>
              <td class="py-3 px-4 text-center">
                ${
                  request.status === "pending"
                    ? `
                  <button 
                    onclick="handleDeposit('${request._id}', 'approved')"
                    class="bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded mr-2"
                  >승인</button>
                  <button 
                    onclick="handleDeposit('${request._id}', 'rejected')"
                    class="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded"
                  >거절</button>
                `
                    : ""
                }
              </td>
            `;
            container.appendChild(tr);
          });
        } catch (err) {
          showToast("충전 요청 목록을 불러오는데 실패했습니다.");
        }
      }

      // 충전 요청 처리 함수
      async function handleDeposit(requestId, status) {
        if (
          !confirm(
            `정말로 이 충전 요청을 ${
              status === "approved" ? "승인" : "거절"
            }하시겠습니까?`
          )
        ) {
          return;
        }

        try {
          const res = await fetch(
            `http://127.0.0.1:5000/api/admin/deposit-requests/${requestId}`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ status }),
            }
          );

          const data = await res.json();
          showToast(data.message);

          if (res.ok) {
            fetchDepositRequests(); // 목록 새로고침
            fetchFinancialSummary(); // 재정 요약 새로고침
          }
        } catch (err) {
          showToast("서버 에러가 발생했습니다.");
        }
      }

      // 승부 조작 패널 토글 함수
      function toggleFixPanel() {
        const modal = document.getElementById("fixPanelModal");
        if (modal.classList.contains("hidden")) {
          modal.classList.remove("hidden");
        } else {
          modal.classList.add("hidden");
        }
      }

      // 모달 외부 클릭 시 닫기
      function closeFixPanelOnOutsideClick(event) {
        if (event.target.id === "fixPanelModal") {
          toggleFixPanel();
        }
      }

      // 승부 조작 함수
      function fixGameResult(result) {
        if (!socket) {
          showToast("소켓 연결이 없습니다.");
          return;
        }

        // 베팅이 진행 중일 때만 조작 가능
        if (!bettingActive) {
          showToast("베팅 시간이 아닙니다.");
          return;
        }

        // 랜덤 패턴 생성 (1~6)
        const randomPattern = Math.floor(Math.random() * 6) + 1;

        const resultText =
          result === "player"
            ? "플레이어"
            : result === "banker"
            ? "뱅커"
            : "타이";

        if (
          confirm(`다음 게임 결과를 ${resultText} 승리로 조작하시겠습니까?`)
        ) {
          socket.emit("admin_fix_result", { result, pattern: randomPattern });

          // 버튼 시각적 피드백
          const buttons = ["fixPlayerBtn", "fixBankerBtn", "fixTieBtn"];
          buttons.forEach((btnId) => {
            const btn = document.getElementById(btnId);
            btn.classList.remove("bg-blue-600", "bg-red-600", "bg-green-600");
            btn.classList.add("bg-gray-700");
          });

          const activeBtn = document.getElementById(
            `fix${result.charAt(0).toUpperCase() + result.slice(1)}Btn`
          );
          if (activeBtn) {
            activeBtn.classList.remove("bg-gray-700");
            if (result === "player") {
              activeBtn.classList.add("bg-blue-600");
            } else if (result === "banker") {
              activeBtn.classList.add("bg-red-600");
            } else if (result === "tie") {
              activeBtn.classList.add("bg-green-600");
            }
          }

          // 상태 표시 업데이트
          const statusDisplay = document.getElementById("fixStatusDisplay");
          const statusText = document.getElementById("fixStatusText");
          statusDisplay.classList.remove("hidden");
          statusText.textContent = `설정됨: ${resultText} 승리`;
          statusDisplay.classList.remove("text-gray-400");
          statusDisplay.classList.add("text-green-400");

          // 모달 닫기
          setTimeout(() => {
            toggleFixPanel();
          }, 1500);
        }
      }

      // 승부 조작 관련 소켓 이벤트 리스너
      socket.on("result_fixed", (data) => {
        showToast(data.message);
      });

      // 게임 시작 시 조작 버튼 초기화
      socket.on("betting_started", () => {
        bettingActive = true; // 베팅 활성화
        resetFixPanel();
      });

      // 베팅 종료 시 상태 업데이트
      socket.on("betting_closed", () => {
        bettingActive = false; // 베팅 비활성화
        resetFixPanel();
      });

      // 승부 조작 패널 초기화 함수
      function resetFixPanel() {
        const buttons = ["fixPlayerBtn", "fixBankerBtn", "fixTieBtn"];
        buttons.forEach((btnId) => {
          const btn = document.getElementById(btnId);
          if (btn) {
            btn.classList.remove("bg-blue-600", "bg-red-600", "bg-green-600");
            btn.classList.add("bg-gray-700");
          }
        });

        // 상태 표시 초기화
        const statusDisplay = document.getElementById("fixStatusDisplay");
        const statusText = document.getElementById("fixStatusText");
        if (statusDisplay && statusText) {
          statusDisplay.classList.add("hidden");
          statusText.textContent = "설정된 결과가 없습니다";
          statusDisplay.classList.remove("text-green-400");
          statusDisplay.classList.add("text-gray-400");
        }
      }