use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("could not access {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("{path} is not valid UTF-8")]
    InvalidUtf8 { path: PathBuf },
    #[error("Workspace catalogue at {path} is not valid JSON: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("Workspace catalogue at {path} has unsupported version {version}")]
    UnsupportedVersion {
        path: PathBuf,
        version: serde_json::Value,
    },
    #[error("invalid Workspace catalogue at {path}: {}", issues.join("; "))]
    InvalidCatalogue { path: PathBuf, issues: Vec<String> },
    #[error("no Workspace with id {id}")]
    UnknownWorkspace { id: String },
    #[error("the Workspace changed after this command was issued; nothing was written")]
    StaleCommand,
    #[error("{message}")]
    InvalidCommand { message: String },
    #[error("{path} was replaced, but the change could not be confirmed on disk: {source}")]
    WriteUnconfirmed {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
}
