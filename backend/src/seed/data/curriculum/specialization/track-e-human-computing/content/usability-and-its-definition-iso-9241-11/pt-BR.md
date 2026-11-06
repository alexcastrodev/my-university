---
version: 1.0
updatedAt: 2026-11-04
title: "Usabilidade e sua Definição (ISO 9241-11)"
summary: "A definição de usabilidade da ISO 9241-11: eficácia, eficiência e satisfação para usuários, objetivos e contexto especificados, e como isso torna a usabilidade mensurável."
---
## Objetivos de Aprendizagem

- Enunciar de que a ISO 9241-11 faz a usabilidade depender, e dizer de qual edição vem uma dada redação.
- Listar o que fontes abertas relatam sobre a revisão de 2018 e reconhecer o que elas não mostram, já que o texto da norma é vendido.
- Transformar eficácia, eficiência e satisfação em medidas sobre uma tarefa concreta, com regra de contagem declarada.
- Mostrar com um exemplo calculado que duas medidas das mesmas sessões podem ordenar dois designs em sentidos opostos.
- Separar o modelo da ISO dos cinco componentes de Nielsen e da característica do lado do produto na ISO/IEC 25010.

## Contexto e Motivação

`fitts-law-and-hicks-law` prevê o tempo de um movimento de apontar ou de uma escolha. Esses modelos não dizem se a pessoa conseguiu o que veio buscar. "Este app é fácil de usar" tem o problema oposto: fala do resultado inteiro, mas não nomeia pessoa, objetivo nem situação, então nenhum teste consegue reprová-la.

Lewis e Sauro (2020) contam que, nas décadas de 1980 e 1990, a área não tinha definição acordada, e que a Parte 11 da ISO 9241 foi a resposta: primeiro rascunho em 1988, primeira edição publicada em 15 de março de 1998, substituída em 2018. O preço da precisão é que usabilidade deixa de ser uma propriedade única. Vira uma afirmação sobre usuários, objetivos e contexto especificados, e é isso que a torna mensurável.

## Teoria Central

### O que as fontes gratuitas mostram

O texto da ISO 9241-11 é vendido, então toda redação abaixo vem de uma fonte aberta que a relata, e cada fonte é nomeada. Duas delas imprimem uma frase apresentada como a definição, e a citação fica no inglês original:

| Fonte | Edição | Redação como impressa ali |
|---|---|---|
| Speicher (arXiv, citando a ISO 9241-11:1998) | 1998 | "The extent to which a product can be used by specified users to achieve specified goals with effectiveness, efficiency and satisfaction in a specified context of use." |
| Página da W3C WAI, atualizada em 6 de maio de 2016 | Não nomeia edição; é anterior a 2018 | "extent to which a product can be used by specified users to achieve specified goals effectively, efficiently and with satisfaction in a specified context of use" |

As duas diferem no trecho do meio, e só o texto comprado decide qual é literal. Trate ambas como relatos. Nenhuma é a frase de 2018, e nenhuma redação de 2018 é citada aqui, porque as fontes usadas para a revisão descrevem as mudanças sem reimprimir essa frase.

### O que a definição exige

Leia a frase de 1998 como um formulário com lacunas. Speicher a transforma numa quíntupla:

$$\text{usability}\in\text{LEVEL}\times\text{PRODUCT}\times\text{USERS}\times\text{GOALS}\times\text{CONTEXT}$$

em que LEVEL diz se as métricas são internas, externas ou de uso. O argumento dele é que "usabilidade" não nomeia nada até os elementos terem valores. Ele cita a observação de Brooke: "Usability does not exist in any absolute sense; it can only be defined with reference to particular contexts."

Yamauchi e Ito, resumindo a edição de 1998, listam o que medir exige: uma descrição dos objetivos pretendidos, uma descrição do contexto (usuários, tarefas, equipamento, ambientes), valores-alvo de eficácia, eficiência e satisfação, e pelo menos uma medida de cada. Acrescentam que a norma não dá regra concreta para escolher as medidas, porque a importância relativa dos atributos depende do contexto e do propósito.

### Os três componentes na edição de 1998

A coluna do meio é o resumo de Yamauchi e Ito, e a última é a lista de exemplos que Lewis e Sauro relatam da edição de 1998.

| Componente | Sentido em 1998 | Medidas de exemplo |
|---|---|---|
| Eficácia (effectiveness) | Acurácia e completude com que os usuários atingem os objetivos especificados | Porcentagem de objetivos atingidos; porcentagem de usuários que completam a tarefa; acurácia média das tarefas completadas |
| Eficiência (efficiency) | Recursos gastos em relação a essa acurácia e completude | Tempo para completar a tarefa; tarefas completadas por unidade de tempo; custo monetário de realizar a tarefa |
| Satisfação (satisfaction) | Ausência de desconforto e atitudes positivas em relação ao uso | Escala de avaliação; frequência de uso voluntário; frequência de reclamações |

Nada aqui é fórmula. Cada linha é uma família de medidas, e o estudo precisa escolher uma e defini-la.

### O que a revisão de 2018 mudou (livro vs hoje)

A nota de alterações no registro de catálogo da DIN compara a DIN EN ISO 9241-11:2018-11 com a antecessora alemã de 1999. Ela está em alemão, e isto é um resumo traduzido:

- O título mudou. A referência de Speicher dá o título da parte em 1998 como *Guidance on usability*, e o registro dá *Usability: Definitions and concepts* para 2018.
- O escopo foi ampliado para incluir sistemas e serviços.
- Considera-se uma faixa maior de objetivos, incluindo resultados pessoais e organizacionais.
- A eficiência passa a ser definida em relação aos resultados alcançados, e não à acurácia e completude.
- A satisfação passa a considerar uma faixa maior de aspectos.

O resumo de escopo do registro acrescenta que o documento explica a usabilidade como resultado do uso, e que ele se aplica a sistemas interativos e outros (inclusive ambientes construídos), produtos e serviços.

Lewis e Sauro acrescentam dois pontos da revisão: foram incluídas as possíveis consequências negativas do uso (saúde, segurança, proteção, privacidade, confiança), e o rascunho revisado deixou de dar orientação específica sobre como medir usabilidade. Eles observam que a orientação se mudou, não sumiu: a ISO/IEC 25066 cobre o formato de relatório e a ISO/IEC 25022, as medidas.

Portanto, um livro que diz "a product" e define eficiência por acurácia e completude está relatando 1998. Os conceitos em si continuam: Lewis e Sauro, citando Bevan et al. (2016), dizem que a nova versão os manteve, ampliando o escopo.

### Resultado do uso, não propriedade do artefato

Como usabilidade é um resultado, uma interface não tem um número único de usabilidade. `the-iso-iec-25010-quality-model` cita a edição de 2023 daquela norma chamando interaction capability de "a prerequisite for usability": a característica do lado do produto é algo que você constrói, e a eficácia, a eficiência e a satisfação do uso real são o que você observa depois.

Acessibilidade cabe no mesmo formulário. A página da W3C observa que a definição poderia cobri-la quando os "specified users" incluem pessoas com diversas deficiências e o contexto inclui tecnologias assistivas, e que a prática de usabilidade muitas vezes não considera essas necessidades. As lacunas decidem quem conta.

### Outro modelo: os cinco componentes de Nielsen

O artigo "Usability 101" de Nielsen (2012, revisado em 15 de julho de 2026) define usabilidade por cinco componentes de qualidade: learnability, efficiency, memorability, errors e satisfaction. Ele a separa de utility e define usefulness como usability mais utility. A efficiency dele significa com que rapidez os usuários fazem as tarefas depois de aprender o design, o que é mais estreito que a eficiência da ISO. Dizer "eficiência" num relatório sem dizer qual convida a uma discussão sobre nada.

### Medidas não substituem umas às outras

Sauro (2011) relata que escores SUS pós-teste se correlacionam com conclusão de tarefa e tempo em torno de $r=0{,}24$, o que ele lê como cerca de 6% da variância. Pessoas podem encontrar problemas graves e ainda dar nota alta. Isso dá à exigência de 1998, de uma medida para cada atributo, uma base prática: um número não representa os outros de forma confiável.

## Exemplos Resolvidos

Todos os números desta seção são fictícios. Foram escritos para esta lição, só para exercitar a aritmética, e nenhum estudo assim existe.

### Exemplo 1: preenchendo as lacunas

```text
Produto    site de agendamento de clínica, versão 3
Usuários   pacientes adultos agendando pela primeira vez, sem treino
Objetivo   marcar consulta com clínico geral em data e hora indicadas
Contexto   celular próprio, dados móveis, sem ajuda da equipe
Nível      de uso
```

Agora os três componentes têm referência. Sucesso significa que a consulta existe, com médico, data e hora certos, e que o paciente recebeu a confirmação. Dizer isso antes das sessões importa, como mostra o Exemplo 3.

Uma segunda afirmação de usabilidade, sobre uma recepcionista que agenda para um paciente num desktop, de headset, usa o mesmo produto e tem outros usuários, outro objetivo e outro contexto. Um resultado de uma não diz nada direto sobre a outra.

### Exemplo 2: três medidas, um conjunto de sessões

O design A é um formulário único. O design B acrescenta uma tela de revisão antes de confirmar. São doze sessões fictícias por design, com nota de 1 a 7 depois da tarefa:

```text
                                Design A   Design B
sucessos estritos                  8/12      11/12
taxa de sucesso                   66.7%      91.7%
intervalo de Wilson de 95%       39-86%     65-99%
tempo médio, só sucessos         120.0 s    199.5 s
tempo médio, as 12 sessões      166.25 s   201.25 s
tempo total                     33.25 min  40.25 min
sucessos por minuto               0.241      0.273
nota média                         4.33       5.17
nota média, só sucessos            5.25       5.27
```

O tempo médio entre os sucessos diz que A é mais rápido por quase 80 segundos. Sucessos por minuto de tempo total, a medida de tarefas por unidade de tempo da lista de 1998, diz que B está à frente por cerca de 14%, já que as três sessões abandonadas de A (285 a 310 s) custaram tempo e não renderam nada. Os dois números estão corretos e respondem a perguntas diferentes. Filtrar por sucessos esconde as falhas, então diga qual você usou.

A nota segue o mesmo padrão: a diferença de 0,83 ponto quase some entre os sucessos, então ela vem das sessões que falharam.

Nada disso prova que B é melhor. Os intervalos se sobrepõem bastante, e um teste exato de Fisher bicaudal de 8/12 contra 11/12 dá $p=0{,}32$. Doze sessões mostram uma direção, não uma diferença resolvida.

### Exemplo 3: a regra de contagem move a eficácia

Uma sessão em cada design marcou a data errada. O artigo de Nielsen sobre taxa de sucesso (2001, revisado em 2021) chama data errada de problema maior numa tarefa de pedido parecida, e descreve tanto a pontuação estrita quanto níveis de sucesso parcial.

```text
                       Design A        Design B
data errada = falha    8/12 = 66.7%    11/12 = 91.7%
data errada = sucesso  9/12 = 75.0%    12/12 = 100%
```

Numa clínica, o paciente que chega no dia errado não atingiu o objetivo, então a pontuação estrita faz sentido. Em outro produto, um deslize menor poderia contar. A regra pertence ao plano, escrita antes de os dados existirem, porque depois de ver 12/12 ninguém defende a mais rígida.

### Exemplo 4: de um requisito vago a um requisito testável

"O fluxo de agendamento deve ser fácil de usar" não tem como falhar. Usando as lacunas do Exemplo 1:

```text
Para pacientes adultos de primeira vez, no próprio celular, sem ajuda:
  eficácia     pelo menos 85% marcam o horário correto (regra estrita)
  eficiência   pelo menos 0.25 sucesso por minuto de tempo total
  satisfação   nota média pós-tarefa de pelo menos 5 em 7
```

As metas são escolhas para esta clínica fictícia, não valores de norma alguma. Os 91,7% do design B passam da primeira meta, mas o limite inferior de Wilson é 64,6%, então doze sessões não mostram que a taxa verdadeira chega a 85%. Com 18 de 20 a taxa é 90%, e o intervalo ainda vai de 69,9% a 97,2%. O conselho habitual de Nielsen, de 20 usuários por design para métricas (2001), é uma regra prática para um intervalo razoavelmente estreito, e uma proporção perto de uma meta exigente pode pedir mais. O tamanho de amostra volta em `usability-testing-and-the-system-usability-scale`.

## Equívocos Comuns e Armadilhas

- **"Este produto tem alta usabilidade."** Sem usuários, objetivos e contexto, a frase não tem valor de verdade. O Exemplo 1 mostra duas afirmações diferentes sobre um produto.
- **"A ISO 9241-11 diz como medir usabilidade."** No resumo de Yamauchi e Ito, a edição de 1998 não dá regra para escolher medidas, e Lewis e Sauro relatam que a orientação de medição saiu do rascunho revisado para outras normas.
- **"Eficiência é tempo de tarefa."** Tempo é uma medida. O Exemplo 2 mostra que tempo e sucessos por minuto podem apontar em sentidos opostos.
- **"A definição que li no livro é a atual."** Se ela diz só "a product", relata a primeira edição ou a segue.
- **"Nielsen e a ISO definem a mesma coisa."** Compartilham o nome e se sobrepõem em parte. A eficiência da ISO e a de Nielsen não são intercambiáveis.
- **"Satisfação decorre de bom desempenho."** A correlação de cerca de 0,24 relatada por Sauro é um argumento contra supor isso.

## Resumo

A ISO 9241-11 amarra a usabilidade a usuários, objetivos e contexto de uso especificados, e a julga por eficácia, eficiência e satisfação. A redação de 1998 fala de um produto. Segundo a nota de alterações da DIN, a edição de 2018 ampliou o escopo para sistemas e serviços, alargou os objetivos, redefiniu a eficiência em relação aos resultados alcançados e ampliou a satisfação, e Lewis e Sauro relatam que a orientação de medição foi para outras normas. A redação literal está no texto vendido, então fontes abertas são relatos e precisam ser rotuladas por edição. Cada componente só vira medida com uma regra de contagem fixada antes. Medidas podem discordar nas mesmas sessões, e amostras pequenas mostram uma direção mais vezes do que um veredito.

## Documentation Links

- [DIN Media: DIN EN ISO 9241-11:2018-11](https://www.dinmedia.de/de/norm/din-en-iso-9241-11/279590417): registro de catálogo em alemão, com o resumo do escopo e a nota de alterações em relação à edição de 1999.
- [Lewis and Sauro (2020): Where Did the ISO 9241 Definition of Usability Come From, and Where Is It Going?](https://measuringu.com/iso-9241/): história da Parte 11, as medidas de exemplo de 1998 e as mudanças relatadas para a revisão.
- [W3C WAI: Accessibility, Usability, and Inclusion](https://www.w3.org/WAI/fundamentals/accessibility-usability-inclusion/): uma redação citada da definição e sua relação com acessibilidade.
- [Speicher: What is Usability?](https://arxiv.org/abs/1502.06792): a redação de 1998 e a quíntupla que preenche suas lacunas.
- [Yamauchi and Ito: A Method of Evaluating Effect of QoS Degradation](https://arxiv.org/abs/1502.03612): a seção 3.2 resume os três componentes e o que a medição exige na ISO 9241-11:1998.
- [Nielsen: Usability 101](https://www.nngroup.com/articles/usability-101-introduction-to-usability/): os cinco componentes de qualidade e a relação entre usabilidade e utilidade.
- [Nielsen: Success Rate, the Simplest Usability Metric](https://www.nngroup.com/articles/success-rate-the-simplest-usability-metric/): pontuação estrita e níveis de sucesso parcial.
- [Nielsen: Usability Metrics](https://www.nngroup.com/articles/usability-metrics/): sucesso, tempo, erros e satisfação como medidas básicas, e por que métricas pedem mais usuários.
- [Sauro (2011): Measuring Usability with the System Usability Scale](https://measuringu.com/sus/): a correlação modesta entre SUS e desempenho na tarefa.
