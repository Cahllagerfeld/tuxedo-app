use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ParseLineError {
    #[error("date must use YYYY-MM-DD format")]
    InvalidDate,
    #[error("task description is empty")]
    EmptyDescription,
}

#[derive(Debug, Error)]
pub enum LoadError {
    #[error("path does not exist: {0}")]
    MissingPath(String),
    #[error("path is not a file: {0}")]
    NotAFile(String),
    #[error("failed to read file: {0}")]
    Read(#[from] std::io::Error),
}
