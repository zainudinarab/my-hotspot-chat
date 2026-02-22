(function () {
  // 1. Ambil identitas group dari tag script
  const scriptTag = document.getElementById("chat-widget");
  const groupID = scriptTag ? scriptTag.getAttribute("data-group") : "global";
  const serverUrl = "https://chat.areza.my.id"; // Sesuaikan dengan domain kamu

  // 2. Tambahkan CSS secara dinamis
  const style = document.createElement("style");
  style.innerHTML = `
        #chat-widget-wrapper { position: fixed; bottom: 20px; right: 20px; z-index: 9999; }
        #chat-window { 
            display: none; position: fixed; bottom: 85px; right: 20px; 
            width: 380px; height: 600px; border-radius: 16px; 
            overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.2); 
            background: white; border: 1px solid #ddd; transition: all 0.3s ease; 
        }
        .chat-fab { 
            width: 56px; height: 56px; background: #2563eb; color: white; 
            border-radius: 50%; display: flex; align-items: center; justify-content: center; 
            font-size: 24px; cursor: pointer; box-shadow: 0 4px 15px rgba(37, 99, 235, 0.4); 
            transition: transform 0.2s;
        }
        .chat-fab:hover { transform: scale(1.05); }
        .chat-fab svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 2; }
        
        @media (max-width: 640px) {
            #chat-window { bottom: 0; right: 0; width: 100%; height: 100%; border-radius: 0; border: none; }
            #chat-widget-wrapper { bottom: 15px; right: 15px; }
        }
    `;
  document.head.appendChild(style);

  // 3. Buat Elemen HTML
  const wrapper = document.createElement("div");
  wrapper.id = "chat-widget-wrapper";

  // Kita tambahkan parameter group ke URL iframe
  wrapper.innerHTML = `
        <div id="chat-window">
            <iframe src="${serverUrl}?view=mobile&group=${groupID}" 
                    id="chat-iframe"
                    style="width:100%; height:100%; border:none;"
                    allow="camera; microphone"></iframe>
        </div>
        <div class="chat-fab" id="chat-fab-btn">
            <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
        </div>
    `;
  document.body.appendChild(wrapper);

  // 4. Logika Buka/Tutup
  const btn = document.getElementById("chat-fab-btn");
  const win = document.getElementById("chat-window");

  btn.onclick = () => {
    if (win.style.display === "none" || win.style.display === "") {
      win.style.display = "block";
      // Opsional: ganti icon jadi 'X' saat terbuka
      btn.innerHTML =
        '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    } else {
      win.style.display = "none";
      btn.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    }
  };

  // 5. Mendengarkan perintah tutup dari dalam iframe (postMessage)
  window.addEventListener("message", (event) => {
    if (event.data === "closeChat") {
      win.style.display = "none";
      btn.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    }
  });
})();
