//! Shared HTTP client. Uses the OS TLS stack (SChannel on Windows) and honours
//! system proxy settings. The User-Agent identifies the app, never the user.

use std::time::Duration;

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("DigitalLibrary/", env!("CARGO_PKG_VERSION"), " (desktop ebook reader)"))
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(45))
        .build()
        .expect("failed to build HTTP client")
}
