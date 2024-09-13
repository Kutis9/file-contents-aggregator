import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfiguration, aggregateContents, generateTreeStructure } from '../extension';

suite('VSCode File Contents Aggregator Test Suite', () => {

    const fixturesPath = path.join(__dirname, '../../src/test/fixtures');

    // Pomocná funkcia na vytvorenie dočasných súborov pre testy
    function createTempFiles() {
        if (!fs.existsSync(fixturesPath)) {
            fs.mkdirSync(fixturesPath, { recursive: true });
        }
        fs.writeFileSync(path.join(fixturesPath, 'testfile.ts'), 'console.log("Hello, TypeScript!");');
        fs.writeFileSync(path.join(fixturesPath, 'testfile.md'), '# Test Markdown File');
        fs.writeFileSync(path.join(fixturesPath, 'package.json'), '{"name": "test-package"}');
        fs.writeFileSync(path.join(fixturesPath, 'masterplan.md'), '# Project Masterplan');
        fs.mkdirSync(path.join(fixturesPath, 'ignored-folder'), { recursive: true });
        fs.writeFileSync(path.join(fixturesPath, 'ignored-folder', 'ignored.ts'), 'console.log("This should be ignored");');
    }

    // Pomocná funkcia na vymazanie dočasných súborov po testoch
    function removeTempFiles() {
        fs.rmSync(fixturesPath, { recursive: true, force: true });
    }

    setup(createTempFiles);
    teardown(removeTempFiles);

    // 1. Test registrácie príkazov
    test('Should register all commands', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('file-contents-aggregator.fullAggregate'));
        assert.ok(commands.includes('file-contents-aggregator.treeCreation'));
        assert.ok(commands.includes('file-contents-aggregator.filesToTxt'));
    });

    // 2. Test načítania konfigurácie
    test('Should load correct configuration', () => {
        const config = getConfiguration();
        assert.deepStrictEqual(config.ignoredPaths, ['**/node_modules/**', '**/.git/**']);
        assert.strictEqual(config.includeFileHeaders, true);
        assert.strictEqual(config.generateTreeStructure, true);
        assert.strictEqual(config.treeDepth, 0);
    });

    // 3. Test ignorovania špecifikovaných ciest
    test('Should correctly ignore specified paths during aggregation', async () => {
        const config = {
            ignoredPaths: ['**/ignored-folder/**'],
            includeFileHeaders: true,
            generateTreeStructure: false,
            treeStartPath: '',
            aggregationStartPath: './',
            fileExtensions: ['ts', 'md'],
            treeDepth: 0,
            includeMasterplan: false,
            includePackageJson: false
        };

        const aggregatedContent = await aggregateContents(fixturesPath, config, { report: () => {} }, { isCancellationRequested: false } as vscode.CancellationToken);
        
        assert.ok(!aggregatedContent.includes('ignored-folder'));
        assert.ok(aggregatedContent.includes('testfile.ts'));
        assert.ok(aggregatedContent.includes('testfile.md'));
    });

    // 4. Test filtrovania podľa prípon súborov
    test('Should correctly filter files by extension', async () => {
        const config = {
            ignoredPaths: [],
            includeFileHeaders: true,
            generateTreeStructure: false,
            treeStartPath: '',
            aggregationStartPath: './',
            fileExtensions: ['ts'],
            treeDepth: 0,
            includeMasterplan: false,
            includePackageJson: false
        };

        const aggregatedContent = await aggregateContents(fixturesPath, config, { report: () => {} }, { isCancellationRequested: false } as vscode.CancellationToken);
        
        assert.ok(aggregatedContent.includes('testfile.ts'));
        assert.ok(!aggregatedContent.includes('testfile.md'));
    });

    // 5. Test zrušenia operácie
    test('Should handle cancellation during aggregation', async () => {
        const config = {
            ignoredPaths: [],
            includeFileHeaders: true,
            generateTreeStructure: false,
            treeStartPath: '',
            aggregationStartPath: './',
            fileExtensions: ['ts', 'md'],
            treeDepth: 0,
            includeMasterplan: false,
            includePackageJson: false
        };

        const token = { isCancellationRequested: true } as vscode.CancellationToken;

        const aggregatedContent = await aggregateContents(fixturesPath, config, { report: () => {} }, token);
        
        assert.strictEqual(aggregatedContent, '');
    });

    // 6. Test rešpektovania nastavení hlavičiek súborov a stromovej štruktúry
    test('Should respect file headers and tree structure settings', async () => {
        const config = {
            ignoredPaths: [],
            includeFileHeaders: false,
            generateTreeStructure: true,
            treeStartPath: './',
            aggregationStartPath: './',
            fileExtensions: ['ts', 'md'],
            treeDepth: 0,
            includeMasterplan: false,
            includePackageJson: false
        };

        const aggregatedContent = await aggregateContents(fixturesPath, config, { report: () => {} }, { isCancellationRequested: false } as vscode.CancellationToken);
        const treeStructure = await generateTreeStructure(fixturesPath, config);
        
        assert.ok(aggregatedContent.includes(treeStructure));
        assert.ok(!aggregatedContent.includes('--- testfile.ts ---'));
    });

    // 7. Test zvládnutia chýbajúcich súborov
    test('Should handle missing files gracefully', async () => {
        const config = {
            ignoredPaths: [],
            includeFileHeaders: true,
            generateTreeStructure: false,
            treeStartPath: './non-existent-folder',
            aggregationStartPath: './',
            fileExtensions: ['ts', 'md'],
            treeDepth: 0,
            includeMasterplan: false,
            includePackageJson: false
        };

        try {
            await aggregateContents(fixturesPath, config, { report: () => {} }, { isCancellationRequested: false } as vscode.CancellationToken);
            assert.fail('Should have thrown an error for missing files');
        } catch (error) {
			if (error instanceof Error) {
				assert.ok(error.message.includes('Error finding files'));
			} else {
				assert.fail('Should have thrown an error for missing files');
			}
		}
	});
			

    // 8. Test vykonania príkazu fullAggregate
    test('Should execute fullAggregate command without errors', async () => {
        const commandResult = await vscode.commands.executeCommand('file-contents-aggregator.fullAggregate');
        assert.strictEqual(commandResult, undefined);
    });

    // 9. Test generovania správnej stromovej štruktúry
    test('Should generate correct tree structure', async () => {
        const config = {
            ignoredPaths: [],
            includeFileHeaders: true,
            generateTreeStructure: true,
            treeStartPath: './',
            aggregationStartPath: './',
            fileExtensions: ['ts', 'md'],
            treeDepth: 2,
            includeMasterplan: false,
            includePackageJson: false
        };

        const treeStructure = await generateTreeStructure(fixturesPath, config);
        
        assert.ok(treeStructure.includes('fixtures'));
        assert.ok(treeStructure.includes('testfile.ts'));
        assert.ok(treeStructure.includes('testfile.md'));
        assert.ok(!treeStructure.includes('ignored-folder'));
    });

    // 10. Test rešpektovania nastavenia hĺbky stromu
    test('Should respect tree depth setting', async () => {
        const config = {
            ignoredPaths: [],
            includeFileHeaders: true,
            generateTreeStructure: true,
            treeStartPath: './',
            aggregationStartPath: './',
            fileExtensions: ['ts', 'md'],
            treeDepth: 1,
            includeMasterplan: false,
            includePackageJson: false
        };

        const treeStructure = await generateTreeStructure(fixturesPath, config);
        
        const lines = treeStructure.split('\n');
        assert.ok(lines.length <= 3);
    });

    // 11. Test zahrnutia masterplan súboru
    test('Should include masterplan file when specified', async () => {
        const config = {
            ignoredPaths: [],
            includeFileHeaders: true,
            generateTreeStructure: false,
            treeStartPath: '',
            aggregationStartPath: './',
            fileExtensions: ['ts', 'md'],
            treeDepth: 0,
            includeMasterplan: true,
            includePackageJson: false
        };

        const aggregatedContent = await aggregateContents(fixturesPath, config, { report: () => {} }, { isCancellationRequested: false } as vscode.CancellationToken);
        
        assert.ok(aggregatedContent.includes('masterplan.md'));
    });

    // 12. Test zahrnutia package.json
    test('Should include package.json when specified', async () => {
        const config = {
            ignoredPaths: [],
            includeFileHeaders: true,
            generateTreeStructure: false,
            treeStartPath: '',
            aggregationStartPath: './',
            fileExtensions: ['ts', 'md'],
            treeDepth: 0,
            includeMasterplan: false,
            includePackageJson: true
        };

        const aggregatedContent = await aggregateContents(fixturesPath, config, { report: () => {} }, { isCancellationRequested: false } as vscode.CancellationToken);
        
        assert.ok(aggregatedContent.includes('package.json'));
    });

    // 13. Test spracovania veľkých súborov
    test('Should handle large files correctly', async () => {
        const largePath = path.join(fixturesPath, 'large-file.txt');
        const largeContent = 'a'.repeat(1000000); // 1MB
        fs.writeFileSync(largePath, largeContent);

        const config = {
            ignoredPaths: [],
            includeFileHeaders: true,
            generateTreeStructure: false,
            treeStartPath: '',
            aggregationStartPath: './',
            fileExtensions: ['txt'],
            treeDepth: 0,
            includeMasterplan: false,
            includePackageJson: false
        };

        const aggregatedContent = await aggregateContents(fixturesPath, config, { report: () => {} }, { isCancellationRequested: false } as vscode.CancellationToken);
        
        assert.ok(aggregatedContent.includes('large-file.txt'));
        assert.ok(aggregatedContent.length >= 1000000);

        fs.unlinkSync(largePath);
    });

});