use serde::{Serialize, Serializer};

/// Every fallible command returns this. It serializes to `{ kind, message }`
/// so the frontend can branch on `kind` without parsing strings.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not read book: {0}")]
    Parse(String),
    #[error("unsupported file type: {0}")]
    Unsupported(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("{0}")]
    Invalid(String),
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        // Strip the URL so errors shown in the UI stay short.
        AppError::Network(e.without_url().to_string())
    }
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::Db(_) => "db",
            AppError::Io(_) => "io",
            AppError::Parse(_) => "parse",
            AppError::Unsupported(_) => "unsupported",
            AppError::NotFound(_) => "notFound",
            AppError::Network(_) => "network",
            AppError::Invalid(_) => "invalid",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
