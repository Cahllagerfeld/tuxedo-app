use std::fs;

use crate::atomic_file::atomic_replace;

#[test]
fn atomic_replace_creates_parents_replaces_contents_and_leaves_no_temporary_file() {
    let root = super::temp_dir();
    let root = root.path();
    let dir = root.join("nested/dir");
    let path = dir.join("todo.txt");

    atomic_replace(&path, b"\xef\xbb\xbffirst\r\n", 0o600).unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"\xef\xbb\xbffirst\r\n");

    atomic_replace(&path, b"second", 0o644).unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"second");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o7777;
        assert_eq!(mode, 0o644);
    }
    let entries: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(entries, ["todo.txt"]);
}

#[test]
fn atomic_replace_failure_leaves_the_destination_unchanged() {
    let root = super::temp_dir();
    let root = root.path();
    // Renaming a file over a non-empty directory fails after the temporary file is written.
    let path = root.join("occupied");
    fs::create_dir_all(path.join("child")).unwrap();

    assert!(matches!(
        atomic_replace(&path, b"contents", 0o600),
        Err(crate::CoreError::Io { .. })
    ));
    assert!(path.join("child").is_dir());
    let entries: Vec<_> = fs::read_dir(root)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(entries, ["occupied"], "the temporary file is removed");
}
