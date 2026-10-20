---
version: 1.0
updatedAt: 2026-10-20
title: "Capstone: Escolhendo uma Estratégia de Análise de Programas para uma Base de Código Real"
summary: "Tipos, interpretação abstrata, lógica de separação, execução simbólica e fuzzing dão cada um uma garantia diferente a um custo diferente. Este capstone escolhe uma técnica para três situações realistas (nulidade num monorepo Java grande, um parser C para entrada não confiável, um controlador que nunca pode levantar erro de execução) e declara para cada uma exatamente o que é garantido e o que não é."
---
## Objetivos de Aprendizagem

- Classificar uma necessidade de caça a bugs ou de garantia pela propriedade a estabelecer, pela linguagem e escala do código e pela tolerância a alarmes falsos.
- Selecionar a técnica correspondente desta trilha (tipos plugáveis e propriedade, interpretação abstrata, análise com lógica de separação, execução simbólica, fuzzing, prova dedutiva) e declarar com precisão que garantia ela dá.
- Identificar o que cada garantia não cobre, e organizar as técnicas em camadas de modo que as baratas rodem na hora da edição e as caras rodem fora do caminho crítico.
- Explicar por que a adoção (velocidade, ruído, posição no fluxo de trabalho) é parte de primeira classe da escolha.

## Contexto e Motivação

Os conceitos desta trilha deram, cada um, uma forma diferente de saber algo sobre um programa antes de rodá-lo em produção ou sem rodá-lo. Tipos e propriedade rejeitam classes inteiras de programas em tempo de compilação. A interpretação abstrata prova a ausência de erros de execução superaproximando todas as execuções. A lógica de separação raciocina sobre o heap de forma composicional, e o Infer a transforma num caçador de bugs escalável. A execução simbólica explora caminhos individuais exatamente, e o fuzzing gera entradas em que ninguém pensou. Assistentes de prova e tipos dependentes dão a garantia mais forte ao preço mais alto. Language servers e computação incremental decidem com que velocidade qualquer uma dessas análises consegue responder.

Nenhuma delas é a melhor em geral. Ficam em pontos diferentes entre **correção** (nunca perder um bug do tipo verificado), **precisão** (poucos alarmes falsos), **escalabilidade** e **custo de adoção**. Os artigos que descrevem a experiência industrial, Bessey et al. sobre análise estática comercial na Coverity, Sadowski et al. sobre o programa Tricorder no Google, e Calcagno e Distefano et al. sobre o Infer no Facebook, concordam numa lição que a teoria pura subestima: uma ferramenta que os desenvolvedores ignoram não acha nada. Este capstone pratica a escolha de uma técnica para uma situação concreta e a declaração da sua garantia e da sua lacuna, no espírito do trabalho de projeto do 6.820 do MIT e do curso de análise estática de Aarhus.

## Teoria Central

### O que cada técnica garante

| Técnica | Garantia | Fraqueza típica | Melhor encaixe |
|---|---|---|---|
| Tipos plugáveis, propriedade | Correta para a propriedade anotada, modular, rápida | Esforço de anotação, bibliotecas tomadas como confiáveis | Nulidade, propriedade de recursos, unidades, no compilador |
| Interpretação abstrata | Correta no seu domínio: nenhum erro perdido da classe modelada | Alarmes falsos, ajuste de domínio, escala | Ausência de erros de execução em código numérico embarcado |
| Análise com lógica de separação (Infer) | Composicional, escala a milhões de linhas, ajustada para achar bugs reais | Não é prova de ausência, lacunas em laços e bibliotecas | Bugs de memória e de recursos a cada mudança de código |
| Execução simbólica ou concólica | Exata por caminho, cada relatório tem uma entrada que falha | Explosão de caminhos, modelos do ambiente | Geração de testes de unidade, bugs lógicos profundos |
| Fuzzing | Todo crash é real e reproduzível | Sem garantia de ausência, raso diante de valores mágicos | Parsers e decodificadores de dados não confiáveis |
| Prova dedutiva | A mais forte: o código cumpre a especificação escrita | Custo mais alto, a especificação pode estar errada | Pequenos núcleos críticos: criptografia, kernels, compiladores |

### Uma lista de diagnóstico

1. **Qual é a propriedade?** "Nenhuma dereferência nula", "nenhum acesso fora dos limites", "nenhum crash em qualquer entrada" e "a saída é igual à especificação" pedem ferramentas diferentes.
2. **Perder um bug custa mais do que um alarme falso?** Se perder é catastrófico (controle de voo, dispositivos médicos), insista em correção e aceite alarmes; se a atenção dos desenvolvedores é o recurso escasso, prefira um caçador de bugs preciso.
3. **Quão grande é o código e com que rapidez a resposta precisa vir?** Segundos no editor significam tipos e linting via language server; minutos na revisão de código significam análise incremental do diff; horas durante a noite permitem análise de programa inteiro e fuzzing longo.
4. **Existe orçamento para anotação ou especificação?** Tipos e provas precisam dele; fuzzing e Infer em grande parte não.
5. **Quem vê o resultado e quando?** Achados mostrados na revisão de código, com mensagem clara e, quando possível, uma correção sugerida, são acionados; um relatório noturno com milhares de itens não. O Tricorder do Google fixou a meta de menos de 10% de falsos positivos efetivos exatamente por isso.

### Camadas

As técnicas são complementares. Um arranjo comum é a **defesa em profundidade por custo**: tipos e linters rápidos na hora da edição (language server), análise estática incremental e testes em cada pull request, fuzzing contínuo no código que analisa entrada não confiável, interpretação abstrata de programa inteiro ou prova para o pequeno componente cuja falha é inaceitável. Cada camada pega o que a mais barata não consegue, e as camadas baratas continuam rápidas porque as caras rodam em outro lugar.

### Declarando a garantia e a lacuna

Para qualquer ferramenta escolhida, escreva: a **propriedade** que ela estabelece, as **premissas** de que precisa (código anotado, um modelo do ambiente, faixas de entrada, o compilador) e a **cobertura** que ela não alcança (caminhos, entradas, bibliotecas, reflexão). A lacuna não é um defeito da redação. Ela diz ao time onde pôr a próxima camada, e o que um relatório limpo significa e não significa.

## Exemplos Resolvidos

### Exemplo 1: nulidade num monorepo Java grande

**Pedido:** Uma empresa tem dois milhões de linhas de Java e centenas de desenvolvedores. `NullPointerException` é uma das principais causas de incidentes em produção. Querem evitar novos sem uma migração em big bang.

**Análise:** A propriedade é local e estrutural (esta expressão pode ser nula?), a linguagem é Java, a escala é grande e a resposta precisa ser rápida o bastante para todo build. Um **sistema de tipos de nulidade plugável** é o melhor encaixe: os desenvolvedores marcam `@Nullable` onde null é permitido, e um verificador como o NullAway (um plugin do Error Prone) verifica o resto de forma modular, a um custo baixo o bastante para rodar em todo build. Ele pode ser adotado pacote a pacote, com modelos para bibliotecas sem anotação. Para casos interprocedurais mais profundos que as anotações não capturam, rode o Infer sobre o diff de cada pull request como segunda camada. A interpretação abstrata da base inteira seria pesada para uma propriedade que tipos expressam barato, e só os testes encontram os caminhos que alguém exercitou.

**Garantia e lacuna:** Nos pacotes anotados, nenhuma dereferência de um valor que o verificador considera não nulo pode levantar `NullPointerException`. A lacuna está nas premissas: código de terceiros sem anotação é tomado como confiável por meio de modelos, reflexão e frameworks de serialização contornam o verificador, e o verificador documenta escolhas deliberadamente não corretas por usabilidade. A ferramenta evita novos defeitos no código anotado; não limpa o código antigo nem prova a ausência de toda falha ligada a null.

### Exemplo 2: um decodificador C para entrada de rede não confiável

**Pedido:** Um time mantém um decodificador de imagens ou de protocolo em C que processa arquivos da Internet. Um bug de segurança de memória é uma vulnerabilidade de execução remota de código.

**Análise:** A propriedade é "nenhuma corrupção de memória em qualquer entrada", o código tem forma de parser e o ponto de entrada é uma única função que recebe bytes. Esse é o encaixe ideal para **fuzzing guiado por cobertura** com ASan e UBSan, rodando continuamente (OSS-Fuzz ou fuzzing em CI), semeado com os arquivos da suíte de testes e um dicionário de palavras-chave do formato. Desvios protegidos por checksums ou números mágicos que travam o fuzzer podem ser destravados com registro de comparações ou com uma ferramenta híbrida que usa execução concólica. Um analisador estático sobre o diff pega os casos rasos na revisão, e a longo prazo o código de parsing mais perigoso é candidato a ser reescrito numa linguagem segura em memória, onde tipos de propriedade dão a garantia em tempo de compilação.

**Garantia e lacuna:** Não há garantia de ausência: todo crash achado é real e reproduzível, mas uma execução limpa só significa que as entradas exploradas estão limpas. O relatório de cobertura mostra que código o fuzzer nunca alcançou, que é a lista concreta da lacuna. Erros lógicos que não causam crash (um pixel errado, um arquivo malformado aceito indevidamente) precisam de propriedades como idas e voltas e checagens diferenciais, já que o oráculo de crash não os enxerga.

### Exemplo 3: um controlador que nunca pode levantar um erro de execução

**Pedido:** Um controlador de 100 mil linhas de C para um dispositivo crítico de segurança não usa memória dinâmica e faz sobretudo aritmética inteira e de ponto flutuante. Um erro de execução (divisão por zero, overflow, índice fora dos limites) é inaceitável, e a certificação exige evidência.

**Análise:** Aqui perder custa muito mais do que um alarme falso, então é necessária uma técnica **correta**. A interpretação abstrata é o encaixe: um analisador correto da classe do Astrée ou do Eva do Frama-C, configurado com as faixas de entrada da especificação de hardware, ou prova a ausência dos erros de execução modelados ou mostra um alarme a resolver. Um padrão de codificação como o MISRA C mantém o código no fragmento que o analisador trata com precisão, e a precisão melhora escolhendo domínios, particionamento e anotações. Para uma função pequena e crítica (uma rotina de aritmética saturada, uma decisão do escalonador), uma **prova dedutiva** com uma ferramenta como o plugin WP do Frama-C contra uma especificação escrita acrescenta a correção funcional que o analisador não declara.

**Garantia e lacuna:** Para toda entrada nas faixas declaradas e sob o modelo de ponto flutuante declarado, nenhum dos erros de execução listados ocorre. Não cobre correção funcional fora das funções provadas, entradas fora das faixas assumidas, falhas de hardware, temporização, nem bugs no compilador (a menos que um compilador verificado também seja usado). As faixas e o modelo do ambiente fazem eles mesmos parte do que precisa ser revisado.

## Equívocos Comuns e Armadilhas

- **"Escolha a técnica mais poderosa."** O poder se paga em esforço de anotação, ajuste e tempo de execução. Um verificador de nulidade que roda em todo build previne mais bugs do que uma prova que nunca é escrita.
- **"Se a ferramenta não reporta nada, o código está limpo."** Significa nenhum achado dentro da garantia. O silêncio de um fuzzer não diz nada sobre caminhos não alcançados, e o silêncio de um caçador de bugs não correto não diz nada sobre os bugs que ele foi projetado para perder.
- **"Uma ferramenta correta é automaticamente útil."** Correção com centenas de alarmes falsos por versão acaba desligada. A posição no fluxo de trabalho, a qualidade da mensagem e a taxa de alarmes falsos decidem se os achados são lidos.
- **"Técnicas estáticas e dinâmicas competem."** Elas acham bugs diferentes. Um fuzzer acha uma entrada; um analisador estático impede que a classe inteira volte; uma prova resolve o núcleo pequeno. Times maduros usam as três em pontos diferentes.

## Resumo

Cada técnica desta trilha dá uma garantia diferente a um custo diferente: tipos e propriedade são corretos para o que rastreiam e rápidos; a interpretação abstrata é correta no seu domínio ao preço de alarmes falsos; a análise com lógica de separação escala e acha bugs reais de heap sem provar ausência; a execução simbólica e o fuzzing produzem entradas que falham, mas não completude; a prova dá a garantia mais forte ao custo mais alto. A escolha decorre da propriedade a estabelecer, do custo de perder contra o de um alarme falso, da escala e da velocidade exigidas, e de onde os achados chegam aos desenvolvedores. Pôr as técnicas baratas em camadas na hora da edição e as caras fora do caminho crítico cobre mais do que qualquer uma sozinha, e declarar a garantia e a lacuna de cada camada diz ao time o que um relatório limpo significa.

## Documentation Links

- [Moller, Schwartzbach: Static Program Analysis (lecture notes, Aarhus University)](https://cs.au.dk/~amoeller/spa/): doc
- [Bessey et al.: A Few Billion Lines of Code Later: Using Static Analysis to Find Bugs in the Real World (Communications of the ACM, 2010)](https://dl.acm.org/doi/10.1145/1646353.1646374): doc
- [Sadowski et al.: Lessons from Building Static Analysis Tools at Google (Communications of the ACM, 2018)](https://dl.acm.org/doi/10.1145/3188720): doc
- [NullAway: a fast annotation-based null checker for Java](https://github.com/uber/NullAway): doc
