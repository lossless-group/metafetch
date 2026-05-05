![Open Graph Fetcher: An Obsidian Community Plugin by The Lossless Group](https://i.imgur.com/0v6sPkv.png)

# Open Graph Fetcher Obsidian Plugin

An Obsidian plugin that allows you to fetch Open Graph data from a URL using OpenGraph.io.

## Why Care?  How we use it...

We manage our site-wide content with Obsidian for ease of use and speed of development. We have a "toolkit" section (and subsections, as well as tag filters) for reviewing applications and web services. To make it more visually compelling, we use Open Graph data to display images and titles in our notes. 

![Lossless Toolkit on The Lossless Group Website](https://i.imgur.com/WX7aIHB.gif)

We use this plugin to fetch Open Graph data from a URL using OpenGraph.io.

## Features

### Command: Fetch Open Graph Data
![Open-Graph-Fetcher Fetch OpenGraph Data for Current File](https://github.com/user-attachments/assets/19ad9691-74d0-4b6e-b4ce-3abb3adea407)

- Opens a modal where the user can configure:
    - Whether to overwrite existing Open Graph data
    - Whether to create new Open Graph data if missing
    - Whether to write errors to YAML frontmatter
    - Whether to update fetch date for processed files
- Fetch Open Graph data from a URL using OpenGraph.io
- See Progress and Status
- Handle errors gracefully and display feedback
- Returns Open Graph data to YAML frontmatter

### Coming Soon:

#### Command: Batch Fetch Open Graph Data

- Select multiple files to process at once
- Pause and resume processing
- Skip files with existing Open Graph data
- Update fetch date for processed files
- Write errors to YAML frontmatter
- Configure delay between requests

# Getting Started as a User

1. Install the plugin from the Obsidian Plugin Marketplace.

2. In Community Plugins, search for "Open Graph Fetcher" and install it.

3. From the Settings tab, click on "Open Graph Fetcher" and configure the settings.

_This [Obsidian](https://obsidian.md/) plugin works only for [OpenGraph.io](https://opengraph.io/)_
<a href="https://opengraph.io/"><img width="252" height="42" alt="trademark_OpenGraph-io" src="https://github.com/user-attachments/assets/08797db6-8fe7-4ced-a4fe-2ad4df79c26a" /></a>

4. Add your OpenGraph.io API key to the settings.

5. Open the Command Palette with `Command + P` (or `Control + P` on Windows & Linux) and type "Open Graph Fetcher".

6. Select "Fetch Open Graph Data for Current File".

7. Magic!

# Getting Started as a Developer from Open Source

**Warning:** This is built assuming pnpm is your package manager. If you are using yarn or npm, you will need to modify the package.json file and may need to modify the code.

Fork the repository, clone it to your local machine, and install dependencies:

```
pnpm install
pnpm add -D esbuild @types/node builtin-modules
pnpm build
pnpm dev
```

## Packages, Dependencies, Libraries:

```json
	"devDependencies": {
		"@types/node": "^24.0.12",
		"@typescript-eslint/eslint-plugin": "8.36.0",
		"@typescript-eslint/parser": "8.36.0",
		"builtin-modules": "5.0.0",
		"esbuild": "0.25.6",
		"eslint": "^9.30.1",
		"tslib": "2.8.1",
		"typescript": "5.8.3"
	},
	"dependencies": {
		"@modelcontextprotocol/sdk": "^1.15.0",
		"dev": "^0.1.3",
		"fastify": "^5.4.0",
		"obsidian": "latest",
		"zod": "^4.0.0"
	}
```

## Using Symbolic Links to Test Your Plugin

If you're like us, you have a directory housing all your code projects. To use your plugin as you develop it, just create a symbolic link. Here is my example, but you will need to use your own path structure:

```bash
ln -s /Users/mpstaton/code/lossless-monorepo/obsidian-plugin-starter /Users/mpstaton/content-md/lossless/.obsidian/plugins/
```

Once you symbolic link from your code to your Obsidian plugins directory, you can develop the plugin but you need to:
1. Make sure it's built and running.
2. Toggle the plugin on in Obsidian Settings: Community Plugins. 