use serde::Serialize;
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

#[derive(Serialize)]
struct GatewayStatus {
    reachable: bool,
    endpoint: &'static str,
    message: &'static str,
}

#[tauri::command]
fn gateway_status() -> GatewayStatus {
    let address: SocketAddr = "127.0.0.1:8787".parse().expect("static gateway address must parse");
    let reachable = TcpStream::connect_timeout(&address, Duration::from_millis(350)).is_ok();
    GatewayStatus {
        reachable,
        endpoint: "http://127.0.0.1:8787",
        message: if reachable { "AI gateway connected" } else { "AI gateway is offline" },
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![gateway_status])
        .run(tauri::generate_context!())
        .expect("error while running Kryeo");
}
