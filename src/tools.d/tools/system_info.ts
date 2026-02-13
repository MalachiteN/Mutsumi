import { ITool, ToolContext } from '../interface';
import { resolveUri } from '../utils';
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as cp from 'child_process';

function execCmd(cmd: string): string {
    try {
        // Synchronous execution for info gathering
        return cp.execSync(cmd, { timeout: 2000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch (e) {
        return '';
    }
}

export const systemInfoTool: ITool = {
    name: 'system_info',
    definition: {
        type: 'function',
        function: {
            name: 'system_info',
            description: 'Get system information (OS, Shell, Package Manager). Must be run BEFORE shell_exec to understand the environment.',
            parameters: {
                type: 'object',
                properties: {},
                required: []
            }
        }
    },
    execute: async (_args: any, _context: ToolContext) => {
        try {
            const platform = os.platform();
            const release = os.release();
            const arch = os.arch();
            
            let info = `Platform: ${platform} (${arch})\nRelease: ${release}`;

            // Shell detection
            const defaultShell = process.env.SHELL || (platform === 'win32' ? process.env.COMSPEC : '/bin/sh');
            info += `\nDefault Shell (Env): ${defaultShell}`;

            const shellCandidates = platform === 'win32' 
                ? ['powershell', 'pwsh', 'cmd', 'bash'] // bash might exist via Git Bash
                : ['bash', 'zsh', 'fish', 'sh', 'csh', 'ksh'];
            
            const foundShells: string[] = [];
            for (const sh of shellCandidates) {
                try {
                    // Use 'where' on Win32 (returns multiple lines sometimes) and 'which' on others
                    const cmdStr = platform === 'win32' ? `where ${sh}` : `which ${sh}`;
                    const result = execCmd(cmdStr);
                    if (result) {
                        // On Windows 'where' might return multiple paths, take the first non-empty one
                        const paths = result.split(/[\r\n]+/);
                        if (paths.length > 0 && paths[0].trim()) {
                            foundShells.push(`${sh}: ${paths[0].trim()}`);
                        }
                    }
                } catch (e) {}
            }
            if (foundShells.length > 0) {
                info += `\nAvailable Shells: ${foundShells.join(', ')}`;
            }

            if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
                // Init System
                const init = execCmd('ps -p 1 -o comm=') || execCmd('cat /proc/1/comm');
                if (init) info += `\nInit System: ${init.trim()} (Controls services via systemctl/service)`;

                // Distro
                const distro = execCmd('cat /etc/*release | grep PRETTY_NAME');
                if (distro) info += `\nDistro Info: ${distro.replace(/PRETTY_NAME=/g, '').replace(/"/g, '')}`;

                // System Package Managers
                const sysPMs = ['apt', 'apt-get', 'yum', 'dnf', 'pacman', 'zypper', 'apk', 'pkg'];
                const foundSysPMs = [];
                for (const pm of sysPMs) {
                    if (execCmd(`which ${pm}`)) foundSysPMs.push(pm);
                }
                if (foundSysPMs.length > 0) info += `\nSystem Package Managers: ${foundSysPMs.join(', ')}`;

            } else if (platform === 'darwin') {
                info += `\nInit System: launchd`;
                if (execCmd('which brew')) {
                    info += `\nSystem Package Manager: homebrew`;
                }
            } else if (platform === 'win32') {
                // Windows System Package Managers
                const winSysPMs = ['choco', 'winget', 'scoop'];
                const foundWinSysPMs = [];
                for (const pm of winSysPMs) {
                    if (execCmd(`where ${pm}`)) foundWinSysPMs.push(pm);
                }
                if (foundWinSysPMs.length > 0) info += `\nSystem Package Managers: ${foundWinSysPMs.join(', ')}`;

                // Service Manager (Windows)
                // Windows uses the Service Control Manager (SCM). We check for common CLI tools to interact with it.
                const scmTools = [];
                if (execCmd('where sc')) scmTools.push('sc');
                if (execCmd('where net')) scmTools.push('net');
                info += `\nService Manager: Windows SCM (CLI tools: ${scmTools.join(', ') || 'Powershell Get-Service'})`;
            }

            // Language Package Managers (Universal)
            const langPMs = ['npm', 'yarn', 'pnpm', 'pip', 'pip3', 'gem', 'cargo', 'rustup', 'go', 'composer', 'mvn', 'gradle'];
            const foundLangPMs = [];
             for (const pm of langPMs) {
                // On Windows 'which' might not exist, use 'where' or just check execution
                const checkCmd = platform === 'win32' ? `where ${pm}` : `which ${pm}`;
                if (execCmd(checkCmd)) foundLangPMs.push(pm);
            }
            if (foundLangPMs.length > 0) info += `\nLanguage Package Managers: ${foundLangPMs.join(', ')}`;

            // Container & Virtualization Tools
            // Definition: [Display Name, CLI Command, { Platform: [Default Paths] }]
            const cvToolsDef: Array<[string, string, Record<string, string[]>]> = [
                ['docker', 'docker', { 
                    'win32': ['C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'],
                    'darwin': ['/Applications/Docker.app/Contents/Resources/bin/docker']
                }],
                ['podman', 'podman', {}],
                ['kubectl', 'kubectl', {}],
                ['minikube', 'minikube', {}],
                ['vagrant', 'vagrant', {}],
                ['wsl', 'wsl', {}],
                ['qemu', 'qemu-system-x86_64', {}],
                ['multipass', 'multipass', {}],
                ['lima', 'limactl', {}],
                ['helm', 'helm', {}],
                ['nerdctl', 'nerdctl', {}],
                ['virtualbox', 'VBoxManage', {
                    'win32': ['C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe'],
                    'darwin': ['/Applications/VirtualBox.app/Contents/MacOS/VBoxManage']
                }],
                ['vmware', 'vmrun', {
                    'win32': [
                        'C:\\Program Files (x86)\\VMware\\VMware Workstation\\vmrun.exe',
                        'C:\\Program Files\\VMware\\VMware Workstation\\vmrun.exe'
                    ],
                    'darwin': ['/Applications/VMware Fusion.app/Contents/Library/vmrun']
                }]
            ];

            const foundCVTools = [];
            
            const checkCmdExists = (cmd: string) => {
                try {
                    const check = platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
                    cp.execSync(check, { stdio: 'ignore' });
                    return true;
                } catch (e) { return false; }
            };

            for (const [name, cmd, paths] of cvToolsDef) {
                // 1. Check PATH
                if (checkCmdExists(cmd)) {
                    foundCVTools.push(name);
                    continue;
                }
                // 2. Check Default Paths for current platform
                if (paths[platform]) {
                    for (const p of paths[platform]) {
                        if (fs.existsSync(p)) {
                            foundCVTools.push(name);
                            break;
                        }
                    }
                }
            }

            if (foundCVTools.length > 0) info += `\nContainer & Virtualization: ${foundCVTools.join(', ')}`;

            return info;
        } catch (err: any) {
            return `Error getting system info: ${err.message}`;
        }
    },
    prettyPrint: (_args: any) => {
        return `💻 Mutsumi checked system info`;
    }
};

export const getFileSizeTool: ITool = {
    name: 'get_file_size',
    definition: {
        type: 'function',
        function: {
            name: 'get_file_size',
            description: 'Get the size of a file in KB. **CRITICAL**: Use this BEFORE reading or editing files to decide whether to use partial read/search or full read/replace, to save tokens.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The file URI.' }
                },
                required: ['uri']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        try {
            const uri = resolveUri(args.uri);
            const stat = await vscode.workspace.fs.stat(uri);
            const sizeKB = (stat.size / 1024).toFixed(2);
            return `Size: ${sizeKB} KB (${stat.size} bytes)`;
        } catch (err: any) {
            return `Error getting file size: ${err.message}`;
        }
    },
    prettyPrint: (args: any) => {
        return `📊 Mutsumi checked size of ${args.uri || '(unknown file)'}`;
    }
};

export const getEnvVarTool: ITool = {
    name: 'get_env_var',
    definition: {
        type: 'function',
        function: {
            name: 'get_env_var',
            description: 'Read the value of a specific system environment variable.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'The name of the environment variable (e.g. PATH, HOME).' }
                },
                required: ['name']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        const key = args.name;
        if (!key) return 'Error: Please specify the environment variable name.';
        
        const value = process.env[key];
        if (value === undefined) {
            return `Environment variable '${key}' is not set.`;
        }
        return value;
    },
    prettyPrint: (args: any) => {
        return `🔧 Mutsumi read environment variable '${args.name || '(unknown)}'}`;
    }
};