ukaz mi cast kodu kde sa original ovplivnuje ci su v quick options zaskrtnute checkboxy lebo teraz to robii zle


Názov projektu: VSCode File Contents Aggregator
Popis:
VSCode File Contents Aggregator je rozšírenie pre Visual Studio Code, ktoré umožňuje používateľom jednoducho zlúčiť obsah všetkých súborov v projekte do jedného textového súboru. Toto rozšírenie je užitočné pre rýchly prehľad kódu, zdieľanie projektu alebo analýzu kódu pomocou AI asistentov.
Cieľ:
Vytvoriť jednoduché a efektívne VS Code rozšírenie, ktoré automatizuje proces zlučovania obsahu súborov, čím šetrí čas vývojárom a uľahčuje zdieľanie kódu.
Hlavné funkcie:
1. Generovanie súboru so zlúčeným obsahom všetkých súborov v projekte
2. Možnosť konfigurácie ignorovaných súborov/priečinkov
3. Pridanie hlavičky ku každému súboru v zlúčenom výstupe
4. Voliteľné generovanie stromovej štruktúry projektu
Technické špecifikácie:
- Platforma: Visual Studio Code
- Programovací jazyk: TypeScript
- API: VS Code Extension API
Implementácia:
1. Vytvorenie základnej štruktúry rozšírenia pomocou Yeoman generátora
2. Implementácia hlavnej logiky na prechádzanie súborov a zlučovanie obsahu
3. Pridanie konfiguračných možností
4. Implementácia generovania stromovej štruktúry (voliteľné)
Časový plán:
- Fáza 1 (2 dni): Nastavenie projektu a implementácia základnej funkcionality
- Fáza 2 (1 deň): Pridanie konfiguračných možností a optimalizácia
- Fáza 3 (1 deň): Testovanie, ladenie a príprava na publikovanie
Budúce rozšírenia:
- Pridanie možnosti výberu konkrétnych priečinkov alebo súborov
- Implementácia progress baru pre väčšie projekty
- Možnosť priameho zdieľania vygenerovaného obsahu (napr. cez Gist)
Publikovanie:
- Príprava metadát a ikonky pre VS Code Marketplace
- Publikovanie rozšírenia na VS Code Marketplace


extension.ts

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface AggregatorConfig {
    ignoredPaths: string[];
    includeFileHeaders: boolean;
    generateTreeStructure: boolean;
    treeStartPath: string;
    aggregationStartPath: string;
    fileExtensions: string[];
    treeDepth: number;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('File Contents Aggregator is now active!');

    let fullAggregateCommand = vscode.commands.registerCommand('file-contents-aggregator.fullAggregate', () => fullAggregate());
    let treeCreationCommand = vscode.commands.registerCommand('file-contents-aggregator.treeCreation', () => treeCreation());
    let filesToTxtCommand = vscode.commands.registerCommand('file-contents-aggregator.filesToTxt', () => filesToTxt());
    let aggregateFromContextCommand = vscode.commands.registerCommand('file-contents-aggregator.aggregateFromContext', (uri: vscode.Uri) => aggregateFromContext(uri));

    context.subscriptions.push(fullAggregateCommand, treeCreationCommand, filesToTxtCommand, aggregateFromContextCommand);
}

async function fullAggregate(customStartPath?: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    let config: AggregatorConfig | undefined = getConfiguration();
    
    config = await getInteractiveOptions(config, customStartPath);
    if (!config) {return;} // User cancelled

    const rootPath = await selectWorkspaceFolder(workspaceFolders);
    if (!rootPath) {return;} // User cancelled

    const outputPath = await selectOutputFile(rootPath);
    if (!outputPath) {return;} // User cancelled

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Aggregating file contents",
            cancellable: true
        }, async (progress, token) => {
            let fileContents = '';
            
            if (config.generateTreeStructure) {
                const treeStructure = await generateTreeStructure(rootPath, config);
                fileContents += treeStructure + '\n\n';
            }
            
            // ... (zvyšok funkcie zostáva nezmenený)
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Error aggregating file contents: ${error}`);
    }
}

async function treeCreation() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    let config: AggregatorConfig = getConfiguration();
    
    // Get tree-specific options
    const treeDepth = await vscode.window.showInputBox({
        prompt: 'Enter the depth from which to start generating the tree (0 for root)',
        value: config.treeDepth.toString()
    });
    if (treeDepth === undefined) {return;} // User cancelled
    config.treeDepth = parseInt(treeDepth);

    const treeStartPath = await getAggregationPath(config.treeStartPath);
    if (!treeStartPath) {return;}; // User cancelled
    config.treeStartPath = treeStartPath;

    const rootPath = await selectWorkspaceFolder(workspaceFolders);
    if (!rootPath) {return;}; // User cancelled

    const outputPath = await selectOutputFile(rootPath);
    if (!outputPath) {return;}; // User cancelled

    try {
        const treeStructure = await generateTreeStructure(rootPath, config);
        fs.writeFileSync(outputPath, treeStructure);
        vscode.window.showInformationMessage(`Tree structure generated in ${outputPath}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Error generating tree structure: ${error}`);
    }
}

async function filesToTxt() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    let config: AggregatorConfig = getConfiguration();
    
    // Get files-specific options
    config.includeFileHeaders = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: 'Include file headers?'
    }).then(result => result === 'Yes');

    const aggregationStartPath = await getAggregationPath(config.aggregationStartPath);
    if (!aggregationStartPath) {return;} // User cancelled
    config.aggregationStartPath = aggregationStartPath;

    const rootPath = await selectWorkspaceFolder(workspaceFolders);
    if (!rootPath) {return;} // User cancelled

    const outputPath = await selectOutputFile(rootPath);
    if (!outputPath) {return;} // User cancelled

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Aggregating file contents",
            cancellable: true
        }, async (progress, token) => {
            const fileContents = await aggregateContents(rootPath, config, progress, token);
            if (token.isCancellationRequested) {
                return;
            }
            fs.writeFileSync(outputPath, fileContents);
            vscode.window.showInformationMessage(`File contents aggregated in ${outputPath}`);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Error aggregating file contents: ${error}`);
    }
}

async function aggregateFromContext(uri: vscode.Uri) {
    await fullAggregate(uri.fsPath);
}

function getConfiguration(): AggregatorConfig {
    const config = vscode.workspace.getConfiguration('fileContentsAggregator');
    return {
        ignoredPaths: config.get('ignoredPaths', ['**/node_modules/**', '**/.git/**']),
        includeFileHeaders: config.get('includeFileHeaders', true),
        generateTreeStructure: config.get('generateTreeStructure', false),
        treeStartPath: config.get('treeStartPath', './'),
        aggregationStartPath: config.get('aggregationStartPath', './src'),
        fileExtensions: config.get('fileExtensions', []),
        treeDepth: config.get('treeDepth', 0)
    };
}

async function getInteractiveOptions(config: AggregatorConfig, customStartPath?: string): Promise<AggregatorConfig | undefined> {
  const options: vscode.QuickPickItem[] = [
      { label: 'Include file headers', picked: config.includeFileHeaders },
      { label: 'Generate tree structure', picked: config.generateTreeStructure },
      { label: 'Specify file extensions to include' }
  ];

  const selectedOptions = await vscode.window.showQuickPick(options, {
      canPickMany: true,
      placeHolder: 'Select options for aggregation'
  });

  if (!selectedOptions) {return undefined;} // User cancelled

  config.includeFileHeaders = selectedOptions.some(option => option.label === 'Include file headers');
  config.generateTreeStructure = selectedOptions.some(option => option.label === 'Generate tree structure');

  if (selectedOptions.some(option => option.label === 'Specify file extensions to include')) {
      const extensions = await vscode.window.showInputBox({
          prompt: 'Enter file extensions to include (comma-separated, e.g., js,ts,py)',
          value: config.fileExtensions.join(',')
      });
      if (extensions !== undefined) {
          config.fileExtensions = extensions.split(',').map(ext => ext.trim()).filter(ext => ext !== '');
      }
  }

  if (customStartPath) {
      config.aggregationStartPath = customStartPath;
  } else {
      config.aggregationStartPath = await getAggregationPath(config.aggregationStartPath);
  }

  return config;
}



async function getAggregationPath(defaultPath: string): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return defaultPath;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;

    return new Promise((resolve) => {
        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = 'Enter or select the starting path for aggregation (relative to workspace root)';
        quickPick.value = defaultPath;
        
        async function updateCompletions() {
            const completions = await getPathCompletions(rootPath, quickPick.value);
            quickPick.items = [
                ...completions.map(completion => ({ label: completion, description: 'Select this path' })),
                { label: 'Confirm Selection', description: 'Use current path and start aggregation', alwaysShow: true }
            ];
        }

        updateCompletions();

        quickPick.onDidChangeValue(async () => {
            updateCompletions();
        });

        quickPick.onDidAccept(() => {
            const selectedItem = quickPick.selectedItems[0];
            if (selectedItem) {
                if (selectedItem.label === 'Confirm Selection') {
                    resolve(quickPick.value);
                    quickPick.hide();
                } else {
                    quickPick.value = selectedItem.label;
                    updateCompletions();
                }
            }
        });

        quickPick.show();
    });
}

async function getPathCompletions(rootPath: string, currentInput: string): Promise<string[]> {
    // Ensure the input starts with './'
    if (!currentInput.startsWith('./')) {
        currentInput = './' + currentInput;
    }

    // Remove './' from the beginning to work with path.join correctly
    const relativePath = currentInput.startsWith('./') ? currentInput.slice(2) : currentInput;
    const fullPath = path.join(rootPath, relativePath);
    
    let dir = fullPath;
    if (!currentInput.endsWith('/')) {
        dir = path.dirname(fullPath);
    }

    try {
        const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
        const completions = files
            .map(([name, type]) => {
                let completionPath = path.join(path.relative(rootPath, dir), name);
                // Ensure the path starts with './'
                completionPath = './' + completionPath;
                // Normalize path separators
                completionPath = completionPath.replace(/\\/g, '/');
                // Add trailing slash to indicate it's a directory
                if (type === vscode.FileType.Directory && !completionPath.endsWith('/')) {
                    completionPath += '/';
                }
                return completionPath;
            })
            .filter(completionPath => {
                // If currentInput ends with '/', show all options in that directory
                if (currentInput.endsWith('/')) {
                    return completionPath.startsWith(currentInput);
                }
                // Otherwise, filter based on the current input
                return completionPath.toLowerCase().startsWith(currentInput.toLowerCase());
            });

        return completions;
    } catch (error) {
        console.error('Error getting path completions:', error);
        return [];
    }
}

async function selectWorkspaceFolder(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<string | undefined> {
    if (workspaceFolders.length === 1) {
        return workspaceFolders[0].uri.fsPath;
    }

    const selected = await vscode.window.showQuickPick(
        workspaceFolders.map(folder => ({ label: folder.name, description: folder.uri.fsPath })),
        { placeHolder: 'Select workspace folder' }
    );

    return selected ? selected.description : undefined;
}

async function selectOutputFile(rootPath: string): Promise<string | undefined> {
    const defaultUri = vscode.Uri.file(path.join(rootPath, 'aggregated_contents.txt'));
    const options: vscode.SaveDialogOptions = {
        defaultUri: defaultUri,
        filters: {
            'Text files': ['txt'],
            'All files': ['*']
        }
    };

    const uri = await vscode.window.showSaveDialog(options);
    return uri ? uri.fsPath : undefined;
}

async function aggregateContents(rootPath: string, config: AggregatorConfig, progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken): Promise<string> {
    let contents = '';
    const aggregationStartPath = path.join(rootPath, config.aggregationStartPath);
    const aggregationFiles = await getFiles(aggregationStartPath, config.ignoredPaths, config.fileExtensions);

    if (config.generateTreeStructure) {
        const treeStartPath = path.join(rootPath, config.treeStartPath);
        const treeFiles = await getFiles(treeStartPath, config.ignoredPaths, config.fileExtensions);
        contents += generateTreeStructure(treeStartPath, treeFiles) + '\n\n';
    }

    const totalFiles = aggregationFiles.length;
    const chunkSize = 100; // Process files in chunks to optimize performance
    for (let i = 0; i < totalFiles; i += chunkSize) {
        if (token.isCancellationRequested) {
            return '';
        }

        const chunk = aggregationFiles.slice(i, i + chunkSize);
        const chunkContents = await Promise.all(chunk.map(async (file) => {
            const relativePath = vscode.workspace.asRelativePath(file);
            const fileContent = await vscode.workspace.fs.readFile(file);
            let fileString = '';
            if (config.includeFileHeaders) {
                fileString += `\n--- ${relativePath} ---\n\n`;
            }
            fileString += fileContent.toString() + '\n\n';
            return fileString;
        }));

        contents += chunkContents.join('');
        progress.report({ message: `Processing files ${i + 1} to ${Math.min(i + chunkSize, totalFiles)} of ${totalFiles}`, increment: (chunkSize / totalFiles) * 100 });
    }

    return contents;
}

async function getFiles(startPath: string, ignoredPaths: string[], fileExtensions: string[]): Promise<vscode.Uri[]> {
    const includePattern = new vscode.RelativePattern(startPath, fileExtensions.length > 0 ? `**/*.{${fileExtensions.join(',')}}` : '**/*');
    const excludePattern = `{${ignoredPaths.join(',')}}`;
    
    try {
        return await vscode.workspace.findFiles(includePattern, excludePattern);
    } catch (err) {
        vscode.window.showErrorMessage(`Error finding files: ${err}`);
        return [];
    }
}

interface TreeNode {
  [key: string]: TreeNode;
}

async function generateTreeStructure(rootPath: string, config: AggregatorConfig): Promise<string> {
    const treeStartPath = path.join(rootPath, config.treeStartPath);
    const files = await getFiles(treeStartPath, config.ignoredPaths, config.fileExtensions);
    
    const fileStructure: TreeNode = {};
    files.forEach(file => {
        const relativePath = path.relative(treeStartPath, file.fsPath);
        const parts = relativePath.split(path.sep).slice(config.treeDepth);
        let currentLevel = fileStructure;

        parts.forEach((part, index) => {
            if (index === parts.length - 1) {
                currentLevel[part] = {};
            } else {
                if (!currentLevel[part]) {
                    currentLevel[part] = {};
                }
                currentLevel = currentLevel[part];
            }
        });
    });

    const rootName = config.treeDepth === 0 ? path.basename(treeStartPath) : path.basename(path.dirname(treeStartPath));
    return `${rootName}\n${renderTree(fileStructure)}`;
}

function renderTree(node: TreeNode, prefix: string = ''): string {
    let result = '';
    const entries = Object.entries(node);
    entries.forEach(([key, value], index) => {
        const isLast = index === entries.length - 1;
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        result += `${prefix}${isLast ? '└── ' : '├── '}${key}\n`;
        if (Object.keys(value).length > 0) {
            result += renderTree(value, newPrefix);
        }
    });
    return result;
}

  

export function deactivate() {}

package.json

{
  "name": "file-contents-aggregator",
  "displayName": "file-contents-aggregator",
  "description": "Aggregates contents of all files in a VS Code project into a single file.",
  "version": "0.0.2",
  "engines": {
    "vscode": "^1.93.0"
  },
  "categories": [
    "Other"
  ],
  "activationEvents": [
    "onCommand:file-contents-aggregator.aggregate"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "file-contents-aggregator.aggregate",
        "title": "AFC - Aggregate File Contents"
      },
      {
        "command": "file-contents-aggregator.aggregateFromContext",
        "title": "AFC - Aggregate From This Folder"
      }
    ],
    "menus": {
      "explorer/context": [
        {
          "when": "explorerResourceIsFolder",
          "command": "file-contents-aggregator.aggregateFromContext",
          "group": "navigation"
        }
      ]
    },
    "configuration": {
      "title": "AFC - File Contents Aggregator",
      "properties": {
        "fileContentsAggregator.ignoredPaths": {
          "type": "array",
          "default": [
            "**/node_modules/**",
            "**/.git/**"
          ],
          "description": "Glob patterns for paths to ignore"
        },
        "fileContentsAggregator.includeFileHeaders": {
          "type": "boolean",
          "default": true,
          "description": "Include headers with file names in the aggregated output"
        },
        "fileContentsAggregator.generateTreeStructure": {
          "type": "boolean",
          "default": false,
          "description": "Generate a tree structure of the project at the beginning of the output"
        },
        "fileContentsAggregator.treeStartPath": {
          "type": "string",
          "default": "./",
          "description": "The starting path for generating the tree structure (relative to workspace root)"
        },
        "fileContentsAggregator.aggregationStartPath": {
          "type": "string",
          "default": "./src",
          "description": "The starting path for aggregating files (relative to workspace root)"
        },
        "fileContentsAggregator.fileExtensions": {
          "type": "array",
          "default": [],
          "description": "File extensions to include in aggregation (e.g., ['js', 'ts', 'py'])"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "pretest": "npm run compile && npm run lint",
    "lint": "eslint src --ext ts",
    "test": "vscode-test"
  },
  "devDependencies": {
    "@types/mocha": "^10.0.7",
    "@types/node": "20.x",
    "@types/vscode": "^1.93.0",
    "@typescript-eslint/eslint-plugin": "^6.9.1",
    "@typescript-eslint/parser": "^6.9.1",
    "@vscode/test-cli": "^0.0.4",
    "@vscode/test-electron": "^2.3.8",
    "eslint": "^8.52.0",
    "typescript": "^5.2.2"
  },
  "dependencies": {
    "vscode-ext-codicons": "^1.6.0"
  }
}
