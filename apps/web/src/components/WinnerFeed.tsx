import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { AnimatePresence, motion } from "motion/react";
import type { ClientToServerEvents, ServerToClientEvents, WinnerFeedEntry } from "@golden/contracts";

/**
 * Evolution-style "recent winners" ticker for a room's sidebar.
 * Server always sends the full ranked list (newest first, capped) on `room.winners`,
 * so this component just replaces its state — no client-side merge/dedup needed.
 */
export function WinnerFeed({ socket }: { socket: Socket<ServerToClientEvents, ClientToServerEvents> }) {
  const [entries, setEntries] = useState<WinnerFeedEntry[]>([]);

  useEffect(() => {
    const handle = ({ entries: next }: { entries: WinnerFeedEntry[] }) => setEntries(next);
    socket.on("room.winners", handle);
    return () => {
      socket.off("room.winners", handle);
    };
  }, [socket]);

  if (entries.length === 0) return null;

  return (
    <div className="winner-feed">
      <h3>승리자 피드</h3>
      <ul>
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <motion.li
              key={entry.id}
              layout
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <span className="winner-feed-name">{entry.maskedUsername}</span>
              <span className="winner-feed-choice">{entry.choiceLabel}</span>
              <span className="winner-feed-amount">+{entry.amount.toLocaleString()}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
