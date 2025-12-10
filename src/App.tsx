import { useEffect, useRef, useState } from "react";
import type { IKGPlayer } from "@ikigaians/ikgplayer";
import { initPlayerInstance, PlayerEventType } from "./stream/stream";
import "./App.css";

const STREAM_URLS = [
  "https://pull-bpgi-test.stream.iki-utl.cc/live/aro0021hd.flv?abr_pts=-1000",
  "https://pull-bpgi-test.stream.iki-utl.cc/live/aro0021hi.flv?abr_pts=-1000",
];

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<IKGPlayer | null>(null);
  const [snapshot, setSnapshot] = useState<string>("");
  const urlIndexRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    const playLoop = async () => {
      // Destroy existing player if any
      if (playerRef.current) {
        try {
          // Take snapshot before destroying
          const snapshotData = playerRef.current.snapshot("webp", 0.8);
          setSnapshot(snapshotData);

          await playerRef.current.stop();
          await playerRef.current.destroy();
        } catch (error) {
          console.error("Error destroying player:", error);
        }
        playerRef.current = null;
      }

      // Create new player instance
      const player = initPlayerInstance(containerRef.current!);
      playerRef.current = player;

      // Set up event listener for first frame
      player.on(PlayerEventType.FIRST_VIDEO_RENDERED, () => {
        console.log(
          "First video frame rendered, will destroy and replay in 1 second"
        );

        // Clear snapshot when video starts playing
        setSnapshot("");

        setTimeout(() => {
          playLoop(); // Restart the loop
        }, 3000);
      });

      // Load and play
      try {
        const currentUrl = STREAM_URLS[urlIndexRef.current];
        console.log(`Playing stream ${urlIndexRef.current + 1}: ${currentUrl}`);

        await player.load(currentUrl);
        await player.play();

        // Switch to next URL for next iteration
        urlIndexRef.current = (urlIndexRef.current + 1) % STREAM_URLS.length;
      } catch (error) {
        console.error("Error playing stream:", error);
        // Retry after a short delay if there's an error
        setTimeout(playLoop, 2000);
      }
    };

    // Start the loop
    playLoop();

    // Cleanup on unmount
    return () => {
      if (playerRef.current) {
        playerRef.current.stop().catch(console.error);
        playerRef.current.destroy().catch(console.error);
      }
    };
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000",
      }}
    >
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <div
          ref={containerRef}
          style={{ width: "100%", height: "100%", backgroundColor: "#000" }}
        />
        {snapshot && (
          <>
            <img
              src={snapshot}
              alt="Snapshot"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 10,
                left: 10,
                backgroundColor: "rgba(0, 0, 0, 0.7)",
                color: "white",
                padding: "5px 10px",
                borderRadius: "4px",
                fontSize: "14px",
                fontWeight: "bold",
              }}
            >
              SNAPSHOT
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
