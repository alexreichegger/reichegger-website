import Link from "next/link";
import { ChatClient } from "./chat-client";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <main>
      <p>
        <Link href="/">← Home</Link> · <Link href="/calendar">Calendar</Link>
      </p>
      <h1>Coach chat</h1>
      <ChatClient />
    </main>
  );
}
