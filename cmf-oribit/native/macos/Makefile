# Oribit - macOS Dial Gesture Detector

APP_NAME := orbit
SWIFT_SOURCE := orbit.swift

PREFIX ?= /usr/local
INSTALL_DIR := $(PREFIX)/bin

.PHONY: all build run install uninstall clean

# Default target
all: build

# Compile the Swift source
build: $(APP_NAME)

$(APP_NAME): $(SWIFT_SOURCE)
	swiftc -O -o $(APP_NAME) $(SWIFT_SOURCE)

# Build and run
run: build
	./$(APP_NAME)

# Install the executable
install: build
	install -d "$(INSTALL_DIR)"
	install -m 755 $(APP_NAME) "$(INSTALL_DIR)/$(APP_NAME)"

# Uninstall the executable
uninstall:
	rm -f "$(INSTALL_DIR)/$(APP_NAME)"

# Remove the locally compiled executable
clean:
	rm -f $(APP_NAME)