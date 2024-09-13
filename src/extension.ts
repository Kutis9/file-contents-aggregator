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
    includeMasterplan: boolean;
    includePackageJson: boolean;
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

    let config: AggregatorConfig = getConfiguration();

    // First, gather interactive options from the user (before gathering paths)
    const updatedConfig = await getInteractiveOptions(config);
    if (!updatedConfig) { return; } // User cancelled
    config = updatedConfig;

    let masterplanPath: string | undefined;
    let packageJsonPath: string | undefined;

    // Handle masterplan.md if selected
    if (config.includeMasterplan) {
        vscode.window.showInformationMessage('Please select the path for masterplan.md.');
        masterplanPath = await getAggregationPath('./masterplan.md', 'Please select the path for masterplan.md');
        if (!masterplanPath) { return; } // User cancelled

        const masterplanFullPath = path.isAbsolute(masterplanPath) 
            ? masterplanPath 
            : path.join(workspaceFolders[0].uri.fsPath, masterplanPath);

        // Check if the masterplan.md file exists
        if (!fs.existsSync(masterplanFullPath)) {
            const userChoice = await vscode.window.showQuickPick(
                ['Create File', 'Ignore', 'Cancel'],
                { placeHolder: `masterplan.md not found at ${masterplanFullPath}. What would you like to do?` }
            );

            if (userChoice === 'Create File') {
                fs.writeFileSync(masterplanFullPath, '# Masterplan\n\n'); // Creates an empty markdown file with a default header
                vscode.window.showInformationMessage(`masterplan.md has been created at ${masterplanFullPath}`);
            } else if (userChoice === 'Ignore') {
                vscode.window.showWarningMessage('Continuing without including masterplan.md.');
                masterplanPath = undefined; // Reset masterplan path if ignored
            } else {
                vscode.window.showInformationMessage('Operation cancelled.');
                return; // Cancel the operation if the user chooses 'Cancel'
            }
        }
    }

    // Handle package.json if selected
    if (config.includePackageJson) {
        vscode.window.showInformationMessage('Please select the path for package.json.');
        packageJsonPath = await getAggregationPath('./package.json', 'Please select the path for package.json');
        if (!packageJsonPath) { return; } // User cancelled
    
        const packageJsonFullPath = path.isAbsolute(packageJsonPath) 
            ? packageJsonPath 
            : path.join(workspaceFolders[0].uri.fsPath, packageJsonPath);  // Correctly calculate full path
    
        // Check if package.json exists
        if (!fs.existsSync(packageJsonFullPath)) {
            vscode.window.showWarningMessage('package.json not found in the selected path. It will not be included in the aggregation.');
            packageJsonPath = undefined;
        } else {
            packageJsonPath = packageJsonFullPath;  // Correctly assign the full path after validation
        }
    }

    // Display a message before asking for the tree start path (used for generating the tree structure)
    if (config.generateTreeStructure) {
        vscode.window.showInformationMessage('Please select the start path for generating the tree structure.');
        const treeStartPath = await getAggregationPath(config.treeStartPath, 'Please select the start path for generating the tree structure.');
        if (!treeStartPath) { return; } // User cancelled
        config.treeStartPath = treeStartPath;
    }

    // Display a message before asking for the aggregation start path (used for file content aggregation)
    vscode.window.showInformationMessage('Please select the start path for file content aggregation.');
    const aggregationStartPath = await getAggregationPath(config.aggregationStartPath, 'Please select the start path for file content aggregation.');
    if (!aggregationStartPath) { return; } // User cancelled
    config.aggregationStartPath = aggregationStartPath;

    const rootPath = await selectWorkspaceFolder(workspaceFolders);
    if (!rootPath) { return; } // User cancelled

    const outputPath = await selectOutputFile(rootPath, "aggregated_Full.txt");
    if (!outputPath) { return; } // User cancelled

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Aggregating file contents",
            cancellable: true
        }, async (progress, token) => {
            let fullContent = '';

            // Include masterplan.md content if the user provided its location and it exists
            if (masterplanPath) {
                const masterplanFullPath = path.isAbsolute(masterplanPath) 
                    ? masterplanPath 
                    : path.join(rootPath, masterplanPath);

                const masterplanContent = fs.readFileSync(masterplanFullPath, 'utf-8');
                fullContent += `--- Masterplan.md ---\n\n` + masterplanContent + '\n\n';
                vscode.window.showInformationMessage('Masterplan.md has been included in the aggregation.');
            }

            if (packageJsonPath) {
                const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
                fullContent += `--- package.json ---\n\n${packageJsonContent}\n\n`;
            }

            // Generate tree structure if the option is selected
            if (config.generateTreeStructure) {
                progress.report({ message: "Generating tree structure", increment: 0 });
                const treeStructure = await generateTreeStructure(rootPath, config);
                fullContent += treeStructure + '\n\n';
            }

            // Then aggregate the file contents
            progress.report({ message: "Aggregating file contents", increment: 50 });
            const fileContents = await aggregateContents(rootPath, { ...config, generateTreeStructure: false }, progress, token);
            if (token.isCancellationRequested) {
                return;
            }
            fullContent += fileContents;

            fs.writeFileSync(outputPath, fullContent);
            vscode.window.showInformationMessage(`Full aggregation completed in ${outputPath}`);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Error during full aggregation: ${error}`);
    }
}



async function treeCreation() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    let config: AggregatorConfig = getConfiguration();
    
    // Get tree depth from settings
    const treeDepth = vscode.workspace.getConfiguration('fileContentsAggregator').get('treeDepth', 0);
    config.treeDepth = treeDepth;

    const treeStartPath = await getAggregationPath(config.treeStartPath, 'Please select the start path for generating the tree structure');
    if (!treeStartPath) {return;} // User cancelled
    config.treeStartPath = treeStartPath;

    const rootPath = await selectWorkspaceFolder(workspaceFolders);
    if (!rootPath) {return;} // User cancelled

    const outputPath = await selectOutputFile(rootPath, "aggregated_Tree.txt");
    if (!outputPath) {return;} // User cancelled

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

    config.generateTreeStructure = false; // Ensure tree structure is not generated

    const aggregationStartPath = await getAggregationPath(config.aggregationStartPath, 'Please select the start path for file content aggregation');
    if (!aggregationStartPath) {return;} // User cancelled
    config.aggregationStartPath = aggregationStartPath;

    const rootPath = await selectWorkspaceFolder(workspaceFolders);
    if (!rootPath) {return;} // User cancelled

    const outputPath = await selectOutputFile(rootPath, "aggregated_FilesToTXT.txt");
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

export function getConfiguration(): AggregatorConfig {
    const config = vscode.workspace.getConfiguration('fileContentsAggregator');
    return {
        ignoredPaths: config.get('ignoredPaths', ['**/node_modules/**', '**/.git/**']),
        includeFileHeaders: config.get('includeFileHeaders', true),
        generateTreeStructure: config.get('generateTreeStructure', true),
        treeStartPath: config.get('treeStartPath', './'),
        aggregationStartPath: config.get('aggregationStartPath', './'),
        fileExtensions: config.get('fileExtensions', []),
        treeDepth: config.get('treeDepth', 0),
        includeMasterplan: config.get('includeMasterplan', false),
        includePackageJson: config.get('includePackageJson', false),
    };
}

async function getInteractiveOptions(config: AggregatorConfig): Promise<AggregatorConfig | undefined> {
    const quickPick = vscode.window.createQuickPick();
    quickPick.canSelectMany = true;
    quickPick.placeholder = 'Select options for aggregation';
    quickPick.items = [
        { label: 'Include file headers', picked: config.includeFileHeaders },
        { label: 'Generate tree structure', picked: config.generateTreeStructure },
        { label: 'Include masterplan.md', picked: config.includeMasterplan },
        { label: 'Include package.json', picked: config.includePackageJson },
        { label: 'Specify file extensions to include', picked: config.fileExtensions.length > 0 }
    ];

    // Force an update of the QuickPick UI
    quickPick.selectedItems = quickPick.items.filter(item => item.picked);

    quickPick.show();

    return new Promise((resolve) => {
        quickPick.onDidAccept(async () => {
            const selectedOptions = quickPick.selectedItems;

            config.includeFileHeaders = selectedOptions.some(option => option.label === 'Include file headers');
            config.generateTreeStructure = selectedOptions.some(option => option.label === 'Generate tree structure');
            config.includeMasterplan = selectedOptions.some(option => option.label === 'Include masterplan.md');
            config.includePackageJson = selectedOptions.some(option => option.label === 'Include package.json');

            if (selectedOptions.some(option => option.label === 'Specify file extensions to include')) {
                const extensions = await vscode.window.showInputBox({
                    prompt: 'Enter file extensions to include (comma-separated, e.g., js,ts,py)',
                    value: config.fileExtensions.join(',')
                });
                if (extensions !== undefined) {
                    config.fileExtensions = extensions.split(',').map(ext => ext.trim()).filter(ext => ext !== '');
                }
            } else {
                config.fileExtensions = [];
            }

            resolve(config);
            quickPick.hide();
        });

        quickPick.onDidHide(() => {
            resolve(undefined);
        });
    });
}


async function getAggregationPath(defaultPath: string, placeholderMessage: string): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return defaultPath;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;

    return new Promise((resolve) => {
        const quickPick = vscode.window.createQuickPick();
        quickPick.placeholder = placeholderMessage; // Custom message for path selection
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

async function selectOutputFile(rootPath: string, fileName: string): Promise<string | undefined> {
    const defaultUri = vscode.Uri.file(path.join(rootPath, fileName));
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

export async function aggregateContents(rootPath: string, config: AggregatorConfig, progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken): Promise<string> {
    let contents = '';
    const aggregationStartPath = path.join(rootPath, config.aggregationStartPath);
    const aggregationFiles = await getFiles(aggregationStartPath, config.ignoredPaths, config.fileExtensions);

    if (config.generateTreeStructure) {
        contents += await generateTreeStructure(rootPath, config) + '\n\n';
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

export async function generateTreeStructure(rootPath: string, config: AggregatorConfig): Promise<string> {
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