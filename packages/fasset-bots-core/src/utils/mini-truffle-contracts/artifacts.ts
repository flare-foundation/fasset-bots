import fs from "fs";
import { globSync } from "glob";
import path from "path";
import { MiniTruffleContract } from "./contracts";
import { ContractJson, ContractSettings } from "./types";
import { Artifacts, Truffle } from "../../../typechain-truffle";
import { AbiItem } from "web3-utils";
import { buildCustomErrorMap } from "./custom-errors";

export class UnknownArtifactError extends Error {}

interface ArtifactData {
    name: string;
    path: string;
    contractJson?: string;
}

export function createArtifacts(rootPath: string, settings: ContractSettings) {
    return new ArtifactsImpl(rootPath, settings);
}

class ArtifactsImpl implements Artifacts {
    private artifactMap?: Map<string, ArtifactData>;
    private customErrorMap?: Map<string, AbiItem>;

    constructor(
        private rootPath: string,
        private settings: ContractSettings
    ) {}

    /**
     * Reads path of all artifacts in artifact root path and creates a map for fast searching in artifacts.require.
     * @returns the generated map
     */
    loadArtifactMap() {
        // const startTime = Date.now();
        const artifactMap = new Map<string, ArtifactData>();
        const paths = globSync(path.join(this.rootPath, "**/*.json").replace(/\\/g, "/"));
        for (const fpath of paths) {
            const name = path.basename(fpath, path.extname(fpath));
            const solPath = path.relative(this.rootPath, path.dirname(fpath)).replace(/\\/g, "/");
            const data: ArtifactData = { name: name, path: fpath };
            artifactMap.set(name, data);
            artifactMap.set(`${solPath}:${name}`, data);
        }
        // console.log(`Loaded artifacts in ${(Date.now() - startTime) / 1000}s`);
        return artifactMap;
    }

    buildCustomErrorMap(artifactMap: Map<string, ArtifactData>) {
        // const startTime = Date.now();
        const artifactList = new Set(artifactMap.values());     // files are duplicated
        const errorAbiList: AbiItem[] = [];
        for (const data of artifactList) {
            const json = this.loadContractJson(data);
            for (const item of json.abi) {
                if (item.type === "error" as any) {
                    errorAbiList.push(item);
                }
            }
        }
        const errorMap = buildCustomErrorMap(errorAbiList);
        // console.log(`Built error map in ${(Date.now() - startTime) / 1000}s`);
        return errorMap;
    }

    /**
     * Load a contract from the artifacts root path. Can search by contract name or full path.
     * @param name either "ContractName" or "full/path/contract.sol:ContractName"
     * @returns a Truffle.Contract instance
     */
    require(name: string): Truffle.Contract<any> {
        const json = this.loadContractJson(this.getArtifactData(name));
        const errorMap = this.getCustomErrorMap();
        return new MiniTruffleContract(this.settings, json.contractName, json.abi, json.bytecode, errorMap, json);
    }

    getCustomErrorMap() {
        if (this.customErrorMap == null) {
            this.customErrorMap = this.buildCustomErrorMap(this.getArtifactMap());
        }
        return this.customErrorMap;
    }

    getArtifactMap() {
        if (this.artifactMap == null) {
            this.artifactMap = this.loadArtifactMap();
        }
        return this.artifactMap;
    }

    getArtifactData(name: string) {
        const artifactData = this.getArtifactMap().get(name);
        if (artifactData == null) {
            throw new UnknownArtifactError(`Unknown artifact ${name}`);
        }
        return artifactData;
    }

    loadContractJson(artifactData: ArtifactData) {
        if (artifactData.contractJson == null) {
            artifactData.contractJson = fs.readFileSync(artifactData.path).toString();
        }
        return JSON.parse(artifactData.contractJson) as ContractJson;
    }
}
