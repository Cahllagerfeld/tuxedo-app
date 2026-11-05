use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("could not read {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("invalid Workspace catalogue at {path}: {message}")]
    InvalidCatalogue { path: PathBuf, message: String },
}
