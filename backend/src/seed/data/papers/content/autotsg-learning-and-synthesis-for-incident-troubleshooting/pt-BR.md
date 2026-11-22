---
title: "AutoTSG: aprendizado e síntese para diagnóstico de incidentes"
summary: Um estudo de como os engenheiros de plantão da Microsoft usam e avaliam os guias de troubleshooting (TSGs), seguido do AutoTSG, um arcabouço que transforma um guia em texto livre em um fluxo executável, classificando suas instruções com uma rede siamesa de poucos exemplos e extraindo seus campos com programas sintetizados a partir de exemplos.
researchArea: Engenharia de software
keywords: guias de troubleshooting, gestão de incidentes, runbooks, plantão, meta-aprendizado, síntese de programas, programação por exemplo, qualidade de documentação
version: 1.0
updatedAt: 2026-11-22
---

## Visão geral

Quando um serviço em nuvem aciona o engenheiro de plantão, ele raramente começa do zero. As equipes escrevem guias de troubleshooting (TSGs), documentos com comandos, consultas, links de painéis e instruções em linguagem natural para problemas recorrentes. O artigo parte da observação de que os TSGs ficam isolados, não têm estrutura e muitas vezes são incompletos, então o engenheiro precisa lê-los, copiar e colar comandos e decidir qual ramo se aplica, com o custo em esforço, cansaço e erro humano que isso traz. A Microsoft tem mais de 50.000 TSGs, usados regularmente por mais de 60.000 engenheiros por mês.

O trabalho tem duas metades. A primeira é um estudo empírico de como os TSGs são usados e de como os engenheiros os avaliam. A segunda é o AutoTSG, um arcabouço que tenta transformar um TSG em um fluxo executável, por exemplo um notebook Jupyter, com uma pessoa ainda no circuito. Li a versão do arXiv do artigo (v1, maio de 2022). A versão publicada no ESEC/FSE 2022 pode diferir.

## Contribuição

- **Um estudo de uso.** Os autores ligam incidentes aos TSGs em que os engenheiros de fato clicaram enquanto os tratavam, ao longo de quatro meses, cobrindo cerca de 4.800 TSGs. O número de incidentes não é divulgado ("1000s").
- **Uma taxonomia de qualidade de TSG.** A partir de 428 comentários sobre 394 TSGs, dois autores codificaram a intenção de cada mensagem e montaram as categorias: Completude, Link quebrado, Correção, Legibilidade, Experiência de uso, Vazio, Atualização, Relevância e Outros. Ela reaproveita parte de uma taxonomia anterior de documentação e acrescenta Vazio e Link quebrado.
- **Identificação de componentes.** O AutoTSG converte os TSGs para Markdown, divide em instruções e classifica cada uma em um tipo de componente (consultas Kusto, PowerShell e dialetos internos de script, links de painel, linguagem natural e assim por diante). Usa meta-aprendizado: uma rede siamesa aprende se duas instruções são do mesmo tipo, e uma instrução recebe o rótulo do protótipo mais próximo, a média dos embeddings dos exemplos de cada tipo. Isso precisa de poucos exemplos rotulados por tipo.
- **Parsing de componentes.** Para extrair as partes necessárias para executar um componente (nome do comando, parâmetros, cluster e tabela de uma consulta), ele sintetiza parsers em Python a partir de poucos exemplos de entrada e saída com programação por exemplo (a biblioteca PROSE). Para linguagem natural, um marcador de constituintes primeiro marca as orações, para que o parser sintetizado consiga extrair uma condição e uma ação. Parâmetros repetidos são tratados extraindo o primeiro, apagando-o e repetindo.

## Metodologia

O estudo de uso junta registros de incidentes a dados de cliques em links de TSG. Para o tempo até mitigar (TTM), os autores mantêm só incidentes de severidade 1 e 2, porque o engenheiro de plantão é acionado na hora e o TTM passa a ser uma aproximação razoável do esforço.

Para a identificação de componentes, 1.902 instruções de 50 TSGs foram rotuladas à mão em 7 tipos de componente. A linguagem natural foi limitada a 200 exemplos para reduzir o desbalanceamento de classes, o que deixa 661 exemplos rotulados, avaliados com validação cruzada de 5 partições contra baselines de k vizinhos mais próximos e floresta aleatória sobre atributos de saco de palavras e Word2Vec. O parsing é testado nas 1.902 instruções, sem sobreposição entre os exemplos de síntese e os dados de teste, e a precisão e a revocação são conferidas à mão. A cobertura é medida nos 15 TSGs mais usados. Por fim, 10 engenheiros de 30 convidados participaram de entrevistas semiestruturadas de 15 minutos.

## Resultados

- **Os TSGs são usados e se repetem.** Em 4 meses, cerca de 47%, 17% e 8% dos TSGs ficaram ligados a pelo menos 2, 5 e 10 incidentes, e seis TSGs a mais de 100 cada (o máximo é 184). Cerca de 85% dos TSGs se ligam a incidentes de severidade alta ou média, e só 30 TSGs se ligam a quedas totais.
- **O TTM médio é menor com TSG.** Para incidentes de severidade 1 e 2, o tempo médio para mitigar é de cerca de 19 horas sem TSG e de cerca de 13 com um. O texto traz um detalhamento da severidade 1 de cerca de 36 horas com TSG contra cerca de 2 sem, o que contradiz a frase que ele sustenta, então uso só os valores agregados.
- **Os comentários são em sua maioria negativos.** Dos 428 itens, 367 (85,7%) foram "polegar para baixo". Completude é a categoria mais frequente (32,24%), seguida de Link quebrado (13,32), Correção (11,21), Legibilidade (10,28), Experiência de uso (10,05), Vazio (7,24), Atualização (6,54) e Relevância (3,97). O texto diz que as três primeiras juntas somam 56%. A concordância entre os dois codificadores foi um kappa de Cohen de 0,907.
- **Identificação de componentes.** A abordagem siamesa chega a 0,89 de acurácia e F1 de 0,72 a 0,98 entre os tipos. O melhor baseline, uma floresta aleatória sobre saco de palavras, chega a 0,78 de acurácia e 0,81 de F1, e é fraco nos tipos que compartilham sintaxe (Torus, Merlin, PowerShell, com F1 de 0,40 a 0,63).
- **Parsing.** Parsers aprendidos com 5 a 10 exemplos chegam a precisão média de 0,94 e revocação de 0,91. Os casos de falha que os autores mostram são formas não cobertas pelos exemplos, como um parâmetro de flag e um pipe.
- **Cobertura.** Nos 15 TSGs mais usados, em média 21,24% de todas as linhas são automatizáveis corretamente, com máximo de 41,2%. Em 12 dos 15 TSGs, toda linha automatizável foi corretamente identificada e processada. A maioria das linhas (títulos, datas, links, descrições de passos, contatos) não é automatizável.
- **Entrevistas.** Os 10 engenheiros disseram que a automação ajudaria, e a nota média de utilidade do AutoTSG foi 4,2 de 5.

## Análise crítica

O estudo usa dados de uso real, cliques de verdade, e não a saída de um recomendador. Também está inteiro dentro de uma empresa, com a contagem de incidentes oculta, e as duas metades não fecham o ciclo: nada no artigo executa um TSG automatizado contra um incidente real e mede o resultado.

Os pontos abaixo são uma leitura minha do artigo, não afirmações dele.

- **A comparação de TTM é uma correlação.** Incidentes ligados a um TSG podem ser os recorrentes e bem compreendidos, e o engenheiro clica em um TSG quando existe um para o problema. O artigo diz que os TSGs "reduzem significativamente" o esforço, mas não relata nenhum teste, e os números da severidade 1 no texto são inconsistentes.
- **0,89 é a acurácia de tipificar instruções.** Diz que o AutoTSG rotula linhas corretamente, não que o fluxo resultante diagnostica ou mitiga algo. Com 21% das linhas automatizáveis em média, o arcabouço automatiza a parte mecânica de um TSG e deixa a maior parte do julgamento com uma pessoa, o que é coerente com o desenho de notebook com humano no circuito.
- **Os dados de avaliação são pequenos e moldados.** Sete tipos e 661 exemplos, com a linguagem natural limitada a 200, são um recorte controlado. Os tipos de componente são internos da Microsoft (Kusto, Jarvis, Torus, Merlin), então não se mostra o quanto a abordagem de poucos exemplos se transfere para as ferramentas de outra organização.
- **O estudo com usuários é favorável por construção.** Dez voluntários de 30 convidados, vendo a saída dos próprios autores em uma entrevista de 15 minutos. Todos os dez disseram sim, e o artigo não relata nenhum caso negativo.
- **Executar passos tem efeitos colaterais.** O artigo trata a automação como ganho de esforço e de consistência. Não discute o que acontece quando um passo automatizado muda o estado da produção. O [StepFly](/papers/stepfly-agentic-troubleshooting-guide-automation), posterior, mantém seu agente em passos de diagnóstico somente de leitura e faz engenheiros revisarem a conclusão antes de qualquer mitigação.

## Pesquisas futuras

- Executar os TSGs convertidos contra incidentes reais ou reproduzidos e comparar o TTM com e sem automação, com grupo de controle.
- Testar a transferência: treinar o classificador de poucos exemplos com as ferramentas de uma organização e avaliá-lo nas de outra.
- Estudar salvaguardas para passos que mudam estado e quando é preciso aprovação humana.
- Usar os sinais de feedback (polegares, relatos de link quebrado) para guiar a manutenção automática, que os autores recomendam, mas não constroem.
