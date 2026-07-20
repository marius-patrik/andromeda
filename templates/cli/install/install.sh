#!/bin/bash
# Unix installer for template-cli
set -e

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"

echo "Installing dependencies..."
bun install

echo "Building template-cli..."
bun run build

echo "Creating template-cli launcher..."
LAUNCHER_PATH="$BIN_DIR/template-cli"
cat << EOF > "$LAUNCHER_PATH"
#!/bin/bash
exec bun "$REPO_DIR/dist/index.js" "\$@"
EOF
chmod +x "$LAUNCHER_PATH"

case :$PATH: in
  *:$BIN_DIR:*) ;;
  *) echo "Please add $BIN_DIR to your PATH (e.g. in ~/.bashrc or ~/.zshrc)" ;;
esac

echo "template-cli installed successfully!"
