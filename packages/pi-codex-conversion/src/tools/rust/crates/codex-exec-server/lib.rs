use async_trait::async_trait;
use codex_utils_absolute_path::AbsolutePathBuf;
use std::io;
use std::sync::{Arc, LazyLock};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CreateDirectoryOptions {
    pub recursive: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RemoveOptions {
    pub recursive: bool,
    pub force: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CopyOptions {
    pub recursive: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileMetadata {
    pub is_directory: bool,
    pub is_file: bool,
    pub is_symlink: bool,
    pub created_at_ms: i64,
    pub modified_at_ms: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReadDirectoryEntry {
    pub file_name: String,
    pub is_directory: bool,
    pub is_file: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileSystemSandboxContext;

#[async_trait]
pub trait ExecutorFileSystem: Send + Sync {
    async fn read_file(&self, path: &AbsolutePathBuf, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<Vec<u8>>;

    async fn read_file_text(&self, path: &AbsolutePathBuf, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<String> {
        let bytes = self.read_file(path, sandbox).await?;
        String::from_utf8(bytes).map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))
    }

    async fn write_file(&self, path: &AbsolutePathBuf, contents: Vec<u8>, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<()>;
    async fn create_directory(&self, path: &AbsolutePathBuf, options: CreateDirectoryOptions, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<()>;
    async fn get_metadata(&self, path: &AbsolutePathBuf, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<FileMetadata>;
    async fn read_directory(&self, path: &AbsolutePathBuf, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<Vec<ReadDirectoryEntry>>;
    async fn remove(&self, path: &AbsolutePathBuf, options: RemoveOptions, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<()>;
    async fn copy(&self, source_path: &AbsolutePathBuf, destination_path: &AbsolutePathBuf, options: CopyOptions, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<()>;
}

pub static LOCAL_FS: LazyLock<Arc<dyn ExecutorFileSystem>> = LazyLock::new(|| Arc::new(LocalFileSystem));

struct LocalFileSystem;

fn reject_sandbox(sandbox: Option<&FileSystemSandboxContext>) -> io::Result<()> {
    if sandbox.is_some() {
        return Err(io::Error::new(io::ErrorKind::Unsupported, "sandboxed filesystem is not available in bundled apply_patch"));
    }
    Ok(())
}

fn metadata_to_file_metadata(metadata: std::fs::Metadata) -> FileMetadata {
    FileMetadata {
        is_directory: metadata.is_dir(),
        is_file: metadata.is_file(),
        is_symlink: metadata.file_type().is_symlink(),
        created_at_ms: metadata.created().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0),
        modified_at_ms: metadata.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0),
    }
}

#[async_trait]
impl ExecutorFileSystem for LocalFileSystem {
    async fn read_file(&self, path: &AbsolutePathBuf, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<Vec<u8>> {
        reject_sandbox(sandbox)?;
        std::fs::read(path.as_path())
    }

    async fn write_file(&self, path: &AbsolutePathBuf, contents: Vec<u8>, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<()> {
        reject_sandbox(sandbox)?;
        std::fs::write(path.as_path(), contents)
    }

    async fn create_directory(&self, path: &AbsolutePathBuf, options: CreateDirectoryOptions, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<()> {
        reject_sandbox(sandbox)?;
        if options.recursive { std::fs::create_dir_all(path.as_path()) } else { std::fs::create_dir(path.as_path()) }
    }

    async fn get_metadata(&self, path: &AbsolutePathBuf, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<FileMetadata> {
        reject_sandbox(sandbox)?;
        std::fs::symlink_metadata(path.as_path()).map(metadata_to_file_metadata)
    }

    async fn read_directory(&self, path: &AbsolutePathBuf, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<Vec<ReadDirectoryEntry>> {
        reject_sandbox(sandbox)?;
        std::fs::read_dir(path.as_path())?.map(|entry| {
            let entry = entry?;
            let metadata = entry.metadata()?;
            Ok(ReadDirectoryEntry {
                file_name: entry.file_name().to_string_lossy().into_owned(),
                is_directory: metadata.is_dir(),
                is_file: metadata.is_file(),
            })
        }).collect()
    }

    async fn remove(&self, path: &AbsolutePathBuf, options: RemoveOptions, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<()> {
        reject_sandbox(sandbox)?;
        let metadata = std::fs::symlink_metadata(path.as_path())?;
        if metadata.is_dir() {
            if options.recursive { std::fs::remove_dir_all(path.as_path()) } else { std::fs::remove_dir(path.as_path()) }
        } else {
            match std::fs::remove_file(path.as_path()) {
                Ok(()) => Ok(()),
                Err(err) if options.force && err.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(err) => Err(err),
            }
        }
    }

    async fn copy(&self, source_path: &AbsolutePathBuf, destination_path: &AbsolutePathBuf, options: CopyOptions, sandbox: Option<&FileSystemSandboxContext>) -> io::Result<()> {
        reject_sandbox(sandbox)?;
        if options.recursive {
            return Err(io::Error::new(io::ErrorKind::Unsupported, "recursive copy is not implemented in bundled apply_patch"));
        }
        std::fs::copy(source_path.as_path(), destination_path.as_path()).map(|_| ())
    }
}
