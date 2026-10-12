use serde::ser::SerializeStruct;

/// The one error type that crosses the command boundary. `code` is stable; `message` is for people.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Git(#[from] git2::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("{message}")]
    App { code: &'static str, message: String },
}

impl Error {
    pub fn app(code: &'static str, message: impl Into<String>) -> Self {
        Error::App {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Error::Io(_) => "io",
            Error::Git(_) => "history",
            Error::Json(_) => "json",
            Error::Zip(_) => "bundle_invalid",
            Error::App { code, .. } => code,
        }
    }
}

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let mut st = s.serialize_struct("Error", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

pub type Result<T> = std::result::Result<T, Error>;
