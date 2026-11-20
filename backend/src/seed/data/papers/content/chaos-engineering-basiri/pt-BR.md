---
title: "Chaos Engineering"
summary: Um artigo de prática e visão da Netflix que dá nome à engenharia do caos, a disciplina de experimentar num sistema distribuído para ganhar confiança de que ele aguenta condições turbulentas em produção, propõe quatro princípios e um experimento em quatro passos, e os ilustra com Chaos Monkey, Chaos Kong e a métrica de inícios de streaming por segundo.
researchArea: Sistemas distribuídos
keywords: engenharia do caos, Netflix, estado estável, injeção de falhas, experimentação em produção, Chaos Monkey
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Serviços de software modernos são implementados como sistemas distribuídos com comportamento e modos de falha complexos. Muitas grandes empresas de tecnologia usam experimentação para verificar a confiabilidade desses sistemas. Usamos o termo "Chaos Engineering" para designar essa abordagem, e discutimos os princípios que a sustentam e como usá-la para executar experimentos.

## Visão geral

É um artigo da IEEE Software (vol. 33, n. 3, maio/junho de 2016, pp. 35-41) escrito pela equipe Traffic and Chaos da Netflix. Não é um artigo de sistemas nem de medição: é a definição de uma prática que a Netflix e outros grandes provedores de serviços já exerciam, escrita para que ela fosse reconhecida como disciplina.

O problema é como confiar num sistema distribuído em produção diante das falhas que realmente acontecem. Na Netflix, engenheiros publicam código e mudam configuração de runtime centenas de vezes por dia, então "instale software comprovado e deixe em paz" (conselho de Jim Gray, de 1985) não é opção. Os autores argumentam que as especificações funcionais desses sistemas são incompletas e que a escala dos serviços torna impraticável compor as especificações de cada serviço. Dão também dois modos de falha que exigem teste de integração: um cliente com fila local ilimitada para um servidor sobrecarregado esgota a memória, e um erro transitório de um serviço é cacheado e entregue a outros clientes.

O artigo cita o estudo de [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) para dois pontos: 92% das falhas catastróficas vêm do tratamento incorreto de erros não fatais, e muitas falhas exigem combinações de eventos.

## Contribuição

- **Uma definição.** Engenharia do caos é "a disciplina de experimentar num sistema distribuído para construir confiança na sua capacidade de resistir a condições turbulentas em produção": uma falha de hardware, um pico de requisições ou um parâmetro de runtime malformado.
- **Uma perspectiva de sistema.** Tratar os serviços em produção como um único sistema e observar métricas na fronteira dele, perguntando "os usuários estão reclamando?" antes de "a implementação bate com a especificação?".
- **Quatro princípios.** Formular uma hipótese sobre o comportamento em estado estável, variar eventos do mundo real, executar experimentos em produção e automatizá-los para rodar continuamente.
- **Um experimento em quatro passos.** Definir o estado estável como uma saída mensurável que indica comportamento normal; supor que ele continua num grupo de controle e num grupo experimental; introduzir variáveis que refletem eventos do mundo real; tentar refutar a hipótese procurando diferença entre os grupos.
- **Uma agenda de pesquisa.** Estudos de caso de outros domínios, adoção, ferramentas reutilizáveis e modelos de injeção de eventos, já que falhas costumam ser disparadas por combinações de eventos.

## Metodologia

Não há seção de avaliação. O artigo se apoia na experiência da Netflix e em exemplos. A empresa roda o Chaos Monkey (encerra aleatoriamente máquinas virtuais de produção, em horário comercial para que engenheiros possam responder), o Chaos Kong (simula a perda de uma região inteira da Amazon EC2, cerca de uma vez por mês) e o Failure Injection Testing (FIT), que faz requisições entre serviços falharem. O Control Plane roda na AWS em três regiões (Norte da Virgínia, Oregon e Irlanda); a CDN Open Connect fica fora do escopo dos exemplos.

A métrica de estado estável é o SPS, (stream) starts per second, escolhida porque varia de forma lenta e previsível ao longo do dia e reflete diretamente se os usuários conseguem assistir. O artigo a contrasta com métricas mais finas, como carga de CPU ou tempo de consulta, que são observadas durante o experimento e podem encerrá-lo antes, mas não servem para desenhá-lo. Um experimento hipotético mostra o método: fazer todas as requisições ao serviço de bookmarks falharem para um grupo experimental pequeno de usuários e comparar o SPS com o do grupo de controle.

## Resultados

O artigo relata prática, não medições.

- **Afirmações de experiência.** Diz-se que o Chaos Monkey deu certo, pois hoje todos os engenheiros da Netflix projetam serviços para lidar com falha de instância como algo normal. Não há contagem de incidentes evitados.
- **Estado estável.** O SPS é o principal indicador de saúde, e outro exemplo é o número de novas assinaturas por segundo. Para outros domínios, os autores sugerem compras concluídas por segundo ou anúncios vistos por segundo.
- **Simulação.** A Netflix não tira uma região do ar: redireciona as requisições como se ela tivesse caído. Os autores dizem que é preciso equilibrar o realismo do evento e o risco de prejudicar o sistema, e citam restringir o experimento a um subconjunto de usuários como mitigação de risco.
- **Automação.** A confiança em experimentos passados decai conforme o sistema muda, então os experimentos devem, depois de uma primeira execução manual, rodar repetidamente.
- **Desfecho esperado.** Um experimento termina com mais confiança no sistema ou com uma fraqueza que indica uma melhoria.

## Análise crítica

O que o artigo não afirma: não há avaliação quantitativa de incidentes evitados, nem comparação com testes unitários, de integração ou de injeção de falhas, e o experimento do serviço de bookmarks é hipotético. Todos os resultados citados vêm da própria Netflix, e os autores esperam que outras organizações documentem os seus. A segurança é discutida, não estudada: o risco de um experimento se espalhar é tratado com julgamento, alvo em subconjunto de usuários e encerramento antecipado. O argumento para produção se apoia em afirmação e dois exemplos: mesmo quando um ambiente de teste reproduz o sistema inteiro, dizem os autores, ele nunca reproduz tudo (clientes sintéticos contra reais, configuração de DNS). Afirmam que o teste tradicional não basta para sistemas distribuídos, sem dados que o comparem aos experimentos.

Diferenças em relação ao resumo comum da prática: o artigo nomeia quatro princípios, não três, e "minimizar o raio de impacto" não é um deles neste texto; aparece como a tática do subconjunto de usuários. A métrica de estado estável é um sinal de disponibilidade percebido pelo usuário na fronteira do sistema, não uma métrica de negócio em si.

O trecho a seguir é uma leitura da evidência, não uma afirmação do artigo. O método depende de uma boa métrica de estado estável, e o SPS funciona para a Netflix porque é suave e ligado à disponibilidade. Sistemas cujas falhas são lentas, cinzentas ou autossustentadas podem não aparecer numa métrica assim (veja [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems) e [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild)). Essa leitura vem das páginas do catálogo sobre esses artigos, não de uma nova leitura deles aqui.

Nota de fonte: esta análise foi escrita a partir do manuscrito do arXiv (arXiv:1702.05843, 11 páginas, dos mesmos autores e marcado como publicado na IEEE Software). A versão do periódico ocupa as pp. 35-41 e não foi lida, então diferenças de texto em relação a ela não foram conferidas.

## Pesquisas futuras

- Quais eventos injetar, já que as combinações são difíceis de enumerar (pergunta em aberto no artigo). O framework de injeção de falhas de [Analysis of Network-Partitioning Failures](/papers/analysis-of-network-partitioning-failures-in-cloud-systems) é um exemplo do catálogo de resposta direcionada.
- Como verificar resultados além de uma métrica agregada: o [Elle](/papers/elle-inferring-isolation-anomalies-from-experimental-observations) examina históricos observados de um banco em busca de anomalias de isolamento (indicação do catálogo, não do artigo).
- Latência sob falhas injetadas e fan-out, lacuna que o artigo deixa aberta e que [The Tail at Scale](/papers/the-tail-at-scale) aborda pelo lado da latência.
- Evidência quantitativa de que experimentos contínuos reduzem incidentes, e ferramentas reutilizáveis entre organizações, ambos apontados como em aberto pelos autores.
