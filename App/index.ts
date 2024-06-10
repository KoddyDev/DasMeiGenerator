import "colors";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import axios from "axios";
import {load} from "cheerio";
import * as fs from "node:fs";

puppeteer.use(StealthPlugin());

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

(async () => {
    console.log(`
         █████╗ ███████╗███████╗██╗███╗   ███╗███████╗██╗
        ██╔══██╗██╔════╝██╔════╝██║████╗ ████║██╔════╝██║
        ███████║███████╗███████╗██║██╔████╔██║█████╗  ██║
        ██╔══██║╚════██║╚════██║██║██║╚██╔╝██║██╔══╝  ██║
        ██║  ██║███████║███████║██║██║ ╚═╝ ██║███████╗██║
        ╚═╝  ╚═╝╚══════╝╚══════╝╚═╝╚═╝     ╚═╝╚══════╝╚═╝

    `.blue)

    const start = Date.now();

    if (!fs.existsSync("files")) {
        fs.mkdirSync("files");
    }

    if (!fs.existsSync("das")) {
        fs.mkdirSync("das");
    }

    if (!fs.existsSync("files/cnpj.txt")) {
        fs.writeFileSync("files/cnpj.txt", "");
    }

    if (!fs.existsSync("files/done.txt")) {
        fs.writeFileSync("files/done.txt", "");
    }

    if (!fs.existsSync("files/error.txt")) {
        fs.writeFileSync("files/error.txt", "");
    }

    const doneCnpjList = fs.readFileSync("files/done.txt", "utf-8").split("\n").map(cnpj => cnpj.trim()).filter(cnpj => cnpj);
    const errorCnpjList = fs.readFileSync("files/error.txt", "utf-8").split("\n").map(cnpj => cnpj.trim()).filter(cnpj => cnpj);
    const cnpjList = fs.readFileSync("files/cnpj.txt", "utf-8").split("\n").map(cnpj => cnpj.trim()).filter(cnpj => cnpj && !doneCnpjList.includes(cnpj) && !errorCnpjList.find(errorCnpj => errorCnpj.includes(cnpj)));

    if (!cnpjList.length) {
        console.log("Nenhum CNPJ para processar".red);
        return;
    }

    console.log(`Iniciando processamento de ${cnpjList.length} CNPJs`.blue)

    const browser = await puppeteer.launch({
        defaultViewport: {
            width: 800,
            height: 600,
            isMobile: true
        },
        headless: false,

    });
    const page = await browser.newPage();

    for (const cnpj of cnpjList) {
        const numberedCNPJ = cnpj.replace(/\D/g, '');

        if (!validarCNPJ(numberedCNPJ)) {
            console.log(`[ERRO] CNPJ ${cnpj} inválido`.red);
            fs.appendFileSync("files/error.txt", `${cnpj} - Inválido\n`);
            continue;
        }

        await axios.get("https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/home/sair", {
            headers: {
                cookie: (await page.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
            }
        });

        await page.goto("https://www8.receita.fazenda.gov.br/simplesnacional/aplicacoes/atspo/pgmei.app/");

        const cnpjInput = await page.waitForSelector("input#cnpj");
        const waitForUrl = page.waitForRequest('https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Home/Inicio')
        await page.evaluate((cnpjInput: HTMLInputElement, cnpj: string) => {
            cnpjInput.value = cnpj;
            window['hcaptcha' as keyof typeof window].execute();
        }, cnpjInput, numberedCNPJ);

        const start = Date.now();

        await waitForUrl.catch(async () => {
            // tentar novamente
            page.reload();

            await page.evaluate((cnpjInput: HTMLInputElement, cnpj: string) => {
                cnpjInput.value = cnpj;
                window['hcaptcha' as keyof typeof window].execute();
            }, cnpjInput, numberedCNPJ);

            return page.waitForRequest('https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Home/Inicio')
        })

        const now = new Date()
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())

        const emissionResponse = await axios.post("https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/emissao", {
            "ano": lastMonth.getFullYear()
        }, {
            headers: {
                "cookie": (await page.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
                "Referer": "https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/emissao",
                "Referrer-Policy": "strict-origin-when-cross-origin"
            }
        });

        const fullYear = lastMonth.getFullYear();
        const fullMonth = (lastMonth.getMonth() + 1).toString().padStart(2, '0');
        const fullDay = lastMonth.getDate().toString().padStart(2, '0');

        const nowFullYear = now.getFullYear();
        const nowFullMonth = (now.getMonth() + 1).toString().padStart(2, '0');
        const nowFullDay = now.getDate().toString().padStart(2, '0');

        const html = await load(emissionResponse.data);
        const requestVerificationToken = html('input[name="__RequestVerificationToken"]').val();
        // //// <li><strong>Nome:</strong> 47.187.715 ADEMIR GOMES PINHEIRO</li>
        // buscar um LI que contenha a palavra "Nome" e pegar o texto
        const nome = html('li').filter((_, el) => html(el).text().includes("Nome")).text().split("Nome:")[1].trim();

        const pa = `${fullYear}${fullMonth}`;
        const dataConsolidacao = `${nowFullDay}/${nowFullMonth}/${nowFullYear}`;

        const validateRetificationResponse = await axios.post(
            'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/Emissao/VerificaRetificacaoAutomatica',
            `ano=${fullYear}&listaPA=${pa}&aliquotaDivergente=false&valorTributoDivergente=false`,
            {
                headers: {
                    cookie: (await page.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': 'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/emissao',
                },
                validateStatus: () => true
            }
        );

        if (validateRetificationResponse.data !== "NO") {
            console.log(`[ERRO] CNPJ ${cnpj} possui retificação automática para o mês ${fullMonth}/${fullYear} (${((Date.now() - start) / 1000).toFixed(1)}s)`.red);
            fs.appendFileSync("error.txt", `${cnpj} - Retificação automática\n`);
            continue;
        }

        const dasGenerationResponse = await axios.post(
            'https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/emissao/gerarDas',
            `__RequestVerificationToken=${requestVerificationToken}&pa=${pa}&dataConsolidacao=${dataConsolidacao}&ano=${fullYear}`,
            {
                headers: {
                    cookie: (await page.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            },
        ).catch((error) => {
            console.log(`[ERRO] CNPJ ${cnpj} não possui DAS para o mês ${fullMonth}/${fullYear} (${((Date.now() - start) / 1000).toFixed(1)}s)`.red);
            fs.appendFileSync("files/error.txt", `${cnpj} - Sem DAS\n`);

            return null
        })

        if (!dasGenerationResponse) {
            continue
        }

        const dasHtml = await load(dasGenerationResponse.data);

        const dasTable = dasHtml('table.table.table-hover.table-condensed tbody tr');
        const dasApuracaoCode = dasTable.find('td').eq(1).text().trim();

        if (!dasApuracaoCode) {
            console.log(`[ERRO] CNPJ ${cnpj} não possui DAS para o mês ${fullMonth}/${fullYear} (${((Date.now() - start) / 1000).toFixed(1)}s)`.red);
            fs.appendFileSync("files/error.txt", `${cnpj} - Sem DAS\n`);
        } else {
            const pdfFile = await axios.get("https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgmei.app/emissao/imprimir", {
                headers: {
                    cookie: (await page.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
                },
                responseType: 'arraybuffer',
            });

            fs.writeFileSync(`das/${nome}.pdf`, pdfFile.data);
            fs.appendFileSync("files/done.txt", `${cnpj}\n`);
            console.log(`[SUCESSO] DAS gerado para o CNPJ ${cnpj} no mês ${fullMonth}/${fullYear} (${((Date.now() - start) / 1000).toFixed(1)}s)`.green);
        }

        // se o index for divisivel por 5, aguardar 5 segundos
        if (cnpjList.indexOf(cnpj) % 5 === 0) {
            await delay(5000);
        }
    }

    await browser.close();
    console.log(`Fim do processamento de ${cnpjList.length} CNPJs (${((Date.now() - start) / 1000 / 60).toFixed(1)}m)\nTempo médio por CNPJ: ${((Date.now() - start) / cnpjList.length / 1000).toFixed(1)}s`.blue);
})();

function validarCNPJ(cnpj: string): boolean {
    cnpj = cnpj.replace(/[^\d]+/g, '');

    if (cnpj === '') return false;

    if (cnpj.length !== 14) return false;

    // Elimina CNPJs inválidos conhecidos
    const invalidCNPJs = [
        "00000000000000", "11111111111111", "22222222222222",
        "33333333333333", "44444444444444", "55555555555555",
        "66666666666666", "77777777777777", "88888888888888",
        "99999999999999"
    ];

    if (invalidCNPJs.includes(cnpj)) return false;

    // Valida DVs
    let tamanho = cnpj.length - 2;
    let numeros = cnpj.substring(0, tamanho);
    let digitos = cnpj.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;

    for (let i = tamanho; i >= 1; i--) {
        soma += +numeros.charAt(tamanho - i) * pos--;
        if (pos < 2) pos = 9;
    }

    let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado !== +digitos.charAt(0)) return false;

    tamanho = tamanho + 1;
    numeros = cnpj.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;

    for (let i = tamanho; i >= 1; i--) {
        soma += +numeros.charAt(tamanho - i) * pos--;
        if (pos < 2) pos = 9;
    }

    resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado !== +digitos.charAt(1)) return false;

    return true;
}