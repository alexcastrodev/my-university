---
title: "Agentic SWMM: fluxo de trabalho auditável e reprodutível para modelagem de águas pluviais com Agent Skills e Model Context Protocol"
summary: Os autores colocam um agente de LLM na frente do simulador de águas pluviais SWMM, da EPA, por meio de Skills e ferramentas MCP, e mostram que uma execução comandada em linguagem natural gera arquivos de saída do SWMM idênticos byte a byte aos de uma execução pela linha de comando, com um registro de cada execução baseado em hashes.
researchArea: Engenharia de software
keywords: ia agêntica, model context protocol, agent skills, reprodutibilidade, proveniência, swmm, modelagem de águas pluviais
version: 1.0
updatedAt: 2026-11-03
---

## Resumo

Configurar modelos hidrológicos urbanos, como o Storm Water Management Model (SWMM), para uso operacional continua sendo trabalhoso para muitos modeladores. Propomos o aiswmm, um runtime agêntico especializado em SWMM, junto com um fluxo de trabalho Agentic SWMM que incorpora (Agent) Skills e ferramentas do Model Context Protocol (MCP) para automatizar o pré-processamento no QGIS, a configuração, a execução e o pós-processamento do SWMM. Demonstramos esse fluxo de trabalho acionado por linguagem natural na bacia de Tod Creek (na península de Saanich, na Colúmbia Britânica). Também validamos o fluxo Agentic SWMM em três níveis: (i) uma detecção do ponto de exutório da bacia baseada em QGIS que concorda com o método comercial do PCSWMM® dentro de 0,88% do perímetro da bacia (cerca de 7,5 pixels do modelo digital de elevação); (ii) arquivos de saída do SWMM idênticos byte a byte (idênticos em Secure Hash Algorithm de 256 bits) entre a execução pela linha de comando e os caminhos via MCP em 60 simulações pareadas; e (iii) vazão de pico afluente no exutório da bacia coincidindo em três algarismos significativos entre a interface manual do SWMM e os fluxos Agentic SWMM. Os resultados confirmam que o fluxo Agentic SWMM pode produzir as mesmas saídas que a interface manual do SWMM, já que foram projetados para usar o mesmo motor computacional. Propomos também um contrato de verificação em primeiro lugar e uma cadeia de auditoria em nível de byte que registram as entradas, os parâmetros e as saídas de cada execução, apoiando assim a auditabilidade e a reprodutibilidade. O runtime aiswmm, as Skills, os servidores MCP e a cadeia de auditoria em nível de byte são liberados como código aberto e continuam compatíveis com os principais runtimes agênticos (Codex, Claude Code, Hermes e OpenClaw), para apoiar a modelagem reprodutível em SWMM comandada por linguagem natural.

## Visão geral

Modelos urbanos de águas pluviais como o Storm Water Management Model (SWMM), da EPA, são simuladores baseados em física: o modelador descreve bacias, tubulações e chuva, e o motor calcula o escoamento e a vazão. Montar um modelo, e rodá-lo de novo para muitos cenários, dá bastante trabalho numa interface gráfica, e um resultado que não pode ser rastreado até as entradas exatas é difícil de aceitar em trabalho operacional. Pacotes em Python reduzem o esforço, mas são feitos para programadores, e os autores argumentam que modelos substitutos de aprendizado de máquina são mais difíceis de interpretar e generalizam mal.

Este artigo, do Departamento de Engenharia Mecânica da Universidade de Victoria, no Canadá, saiu na primeira edição da revista AI for Engineering (MDPI, 2026). Ele propõe deixar um modelo de linguagem conduzir o fluxo inteiro, do pré-processamento de dados geográficos aos gráficos, enquanto todo o trabalho numérico fica dentro do motor SWMM, sem alterações. É um artigo de sistemas sobre como colocar um agente de LLM na frente de uma ferramenta científica e ainda conseguir auditar o que aconteceu.

Vale conhecer antes: o que é um laço de agente com chamadas de ferramentas, a ideia do Model Context Protocol (MCP) como forma padrão de expor ferramentas a um modelo, e o que um hash criptográfico como o SHA-256 prova sobre um arquivo.

## Contribuição

- **aiswmm, um runtime de agente específico para SWMM.** Ele orquestra comandos, lê e escreve arquivos e chama programas externos em um ambiente controlado. O laço é inspirado no ReAct, mas emite chamadas de ferramenta estruturadas (function calling) em vez de texto a ser interpretado, e um sistema de regras em cinco camadas decide quando o agente pode agir sozinho e quando deve parar e passar a decisão ao modelador humano. Ele não executa comandos arbitrários.
- **Duas camadas, MCP e Skills.** O MCP expõe as ferramentas (o estudo de caso usa três servidores: pré-processamento geográfico, execução do SWMM e geração de gráficos). As Agent Skills funcionam como procedimentos operacionais padrão: o que chamar, em que ordem e com quais portões de qualidade. Os autores argumentam que só o MCP entrega ferramentas sem procedimento em volta e resultados que dependem da qualidade do prompt.
- **Um contrato de proveniência com verificação em primeiro lugar.** Toda execução grava dois arquivos produzidos por scripts determinísticos das Skills, e não pelo LLM: um manifesto do executor e um arquivo de auditoria. Juntos guardam os hashes SHA-256 dos arquivos de entrada, saída e relatório e o resultado de portões de qualidade (erros de continuidade, integridade do valor de pico, código de retorno do SWMM e oito regras de triagem específicas do SWMM).
- **Testes de equivalência** entre o caminho do agente, a linha de comando do SWMM e a interface gráfica do SWMM, além de uma detecção automática do ponto de exutório no QGIS conferida contra o PCSWMM.
- **Uma versão em código aberto** do runtime, das Skills, dos servidores MCP e da cadeia de auditoria, sob a licença MIT.

## Metodologia

O estudo de caso é a bacia de Tod Creek, com cerca de 17 km² na península de Saanich, na Colúmbia Britânica, com modelo digital de elevação de 27 m, polígonos de solo e de uso da terra e chuva diária de 1984. Um modelo concentrado representa a bacia. O SWMM 5.2.4 é compilado a partir do código-fonte no macOS e chamado como `swmm5 <inp> <rpt> <out>`. O modelo de linguagem principal é o OpenAI GPT-5.5 Thinking (gpt-5.5-2026-04-23), e o QGIS 4.0.2 faz o trabalho geográfico.

A validação tem três níveis:

1. **Ponto de exutório.** A Skill swmm-gis calcula direção e acúmulo de fluxo com o QGIS (método D8) e escolhe a célula com maior acúmulo a montante. O resultado é comparado com um ponto definido à mão no PCSWMM 7.7.
2. **Linha de comando contra MCP.** Dois testes de 30 configurações cada: no primeiro, o parâmetro de tempo até o pico da chuva vai de 0,30 a 0,50; no segundo, varia-se a impermeabilização da bacia. Cada configuração roda pela linha de comando do SWMM e pelo MCP, o que dá 60 pares e 120 execuções. As saídas são comparadas por SHA-256 (ignorando carimbos de data e hora) e por R² e eficiência de Nash-Sutcliffe da vazão de pico.
3. **Interface gráfica contra agente.** O modelo de base que o agente gerou a partir de um prompt é recriado à mão na interface gráfica do SWMM, e a vazão afluente de pico no nó de saída é comparada.

Os autores também auditam três casos de referência externos do SWMM (um caso de janeiro de 1994 do Tecnopolo, um benchmark acoplado TUFLOW-SWMM e um caso Generate_SWMM_inp) contra saídas de referência publicadas. O alcance dessa checagem está no material suplementar, que esta análise não cobre.

## Resultados

Estes são os resultados relatados pelos autores.

- O ponto de exutório automático fica a 0,88% do perímetro da bacia em relação ao ponto do PCSWMM, cerca de 7,5 pixels do modelo de elevação.
- Os 60 pares de linha de comando e MCP geraram arquivos de saída do SWMM idênticos byte a byte (SHA-256, sem contar carimbos de data e hora), R² e NSE exatamente iguais a 1,0, manifestos idênticos, código de retorno 0 e diferença máxima de vazão de pico de 0,0.
- Na comparação com a interface gráfica, a vazão afluente de pico no nó O1 para a chuva de projeto de Chicago de 25 de maio de 1984 (parâmetro de tempo até o pico 0,40) coincide em três algarismos significativos. Os arquivos não são idênticos byte a byte, porque os nomes de nós e junções diferem no modelo montado à mão.
- A auditoria pegou uma inconsistência: dois scripts Python escritos de forma independente pelo LLM escolheram 0,39655 e 0,40345 como o valor mais próximo de 0,40, e as duas figuras foram rotuladas como 0,40. Só os valores de SHA-256 (prefixos diferentes) e os manifestos mostraram a diferença. Os autores tomam isso como evidência a favor do contrato.
- A versão descrita é a v0.6.4, com 14 Skills, 11 servidores MCP e 45 ferramentas MCP. Quatro Skills e seis ferramentas MCP foram usadas na validação.

## Análise crítica

A ideia de engenharia é sólida e os autores são abertos sobre vários limites. Mesmo assim, alguns pontos merecem ser separados da afirmação principal.

- **Saída idêntica byte a byte entre linha de comando e MCP é um teste fraco do agente.** Os dois caminhos chamam o mesmo binário `swmm5` sobre o mesmo arquivo de entrada, então saídas idênticas mostram que o invólucro não acrescenta nenhum passo escondido. Os autores dizem isso. O teste não verifica se o agente monta um modelo sensato a partir de um prompt.
- **A comparação com a interface gráfica parte do modelo do próprio agente.** O modelo de base foi gerado pelo agente e depois recriado à mão, então picos iguais mostram que a interface e o agente rodam o mesmo modelo do mesmo jeito. Não mostram que o agente escolheu bons parâmetros a partir de dados brutos, o que a própria discussão diz que exige julgamento de especialista (por exemplo, nas tabelas de mapeamento de parâmetros).
- **Evidência hidrológica estreita.** Uma bacia, um modelo concentrado, uma chuva de projeto sintética e só a vazão de pico, e os autores afirmam que isso não é uma validação de todas as saídas do SWMM. O texto principal não relata comparação com vazões observadas.
- **As afirmações sobre alucinação são argumentadas, não medidas.** As três camadas de defesa (limite rígido do espaço de ações, ferramentas MCP com esquema verificado, Skills com regras de domínio, como ler o pico no resumo de vazão afluente do nó) são plausíveis. O texto principal não traz taxa de chamadas de ferramenta erradas nem uma execução sem Skills para comparar, e usa um modelo principal. A portabilidade para Codex, Claude Code, Hermes e OpenClaw é afirmada com uma citação, e não mostrada nos experimentos. Os autores também dizem que as restrições são suaves e sujeitas a injeção de prompt.
- **Execução reprodutível não é agente reprodutível.** A cadeia de hashes torna uma execução reprodutível e expõe uma divergência depois do fato, como no exemplo de 0,39655 contra 0,40345. O agente ainda pode escolher diferente em outra tentativa, e o artigo não mede com que frequência.
- **Software em movimento.** Os resultados usam a v0.6.4, enquanto as limitações citam uma camada de memória da v0.7.1 que os autores dizem não estar validada. O projeto é pré-1.0 e está em desenvolvimento ativo.

## Pesquisas futuras

- Um módulo de quantificação de incerteza (os autores citam uma métrica baseada em entropia da bacia) e Skills e ferramentas MCP para divisão em sub-bacias.
- Validar em dados de projetos reais de SWMM o runtime com memória, no qual execuções auditadas do passado orientam as novas.
- Redes urbanas de tubulações, que ainda estão em estado alfa, e outros módulos do SWMM, como qualidade da água, que exigem dados reais da rede e parâmetros de especialistas.
- Perguntas que o artigo deixa abertas: uma ablação com e sem Skills, execuções repetidas do mesmo prompt para medir quanto o agente varia, e o mesmo fluxo com outros modelos e runtimes.
