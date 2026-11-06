---
version: 1.0
updatedAt: 2026-11-04
title: "Percepção e Cognição Humana para o Design de Interfaces"
summary: "Atenção, limites de memória e agrupamento Gestalt, e o que eles implicam para layout, feedback e quanto uma interface pode pedir que uma pessoa lembre."
---
## Objetivos de Aprendizagem

- Descrever o desenho dos estudos de cegueira por desatenção e de cegueira à mudança, e distinguir os dois fenômenos.
- Dizer o que Miller (1956) e Cowan (2001, 2010) mediram de fato, e explicar por que nenhum dos resultados define o tamanho de um menu.
- Usar reconhecimento, evocação e memória externa para decidir quanto uma interface pode pedir que a pessoa lembre.
- Dizer em que sentido as "leis" da Gestalt são leis, e aplicar princípios de agrupamento a um layout sem tratá-los como limiares.
- Escolher o feedback para uma espera usando a orientação sobre tempo de resposta, sabendo que é conselho e de onde veio.

## Contexto e Motivação

`what-hci-studies-users-tasks-and-context` disse que os usuários têm capacidades que mudam o desempenho. Esta lição trata de três delas: a que as pessoas prestam atenção, o que conseguem manter em mente e como agrupam o que veem. Esses temas atraem mais folclore que qualquer outra parte da IHC, porque um número de laboratório é fácil de citar e difícil de aplicar. "Sete itens" e "as pessoas não veem o gorila" começaram como achados cuidadosos sobre tarefas específicas. O hábito a criar aqui é perguntar o que os participantes fizeram, o que foi medido e se a sua interface se parece com aquela situação.

## Teoria Central

### Atenção: cegueira por desatenção

Simons e Chabris (1999) testaram se as pessoas deixam de ver um evento visível enquanto prestam atenção em outra coisa. Os participantes foram 228 observadores, quase todos estudantes de graduação, testados individualmente. Depois do descarte de 36 por motivos declarados, restaram 192, distribuídos igualmente em 16 condições de 12 cada.

Cada observador assistiu a um vídeo de 75 segundos com dois times de três pessoas passando bolas de basquete e contou em silêncio os passes de um dos times. Na tarefa fácil mantinha uma contagem, e na difícil mantinha contagens separadas de passes quicados e aéreos. No meio do vídeo, uma mulher com um guarda-chuva ou uma pessoa fantasiada de gorila atravessava a cena por 5 segundos. Os vídeos eram transparentes (camadas filmadas em separado e sobrepostas) ou opacos (uma única cena ao vivo). Depois vinham perguntas surpresa sobre qualquer coisa incomum.

O resultado principal: dos 192 observadores, 46% não relataram o evento. As outras comparações mostram o que mexe nesse número:

| Comparação | Notaram o evento |
|---|---|
| Vídeo opaco vs. transparente | 67% vs. 42% |
| Contagem fácil vs. difícil | 64% vs. 45% |
| Mulher com guarda-chuva vs. gorila | 65% vs. 44% (texto do artigo; a Tabela 1 dá média de cerca de 43% para o gorila) |
| Gorila, atenção no time preto vs. no branco | 58% vs. 27% |

O gorila era preto, então quem acompanhava o time preto o notava mais. Nas 16 condições, a taxa de notar foi de 8% a 100%. "Metade das pessoas não vê o gorila" é, portanto, uma média de situações muito diferentes. O estudo trata de um evento inesperado durante uma tarefa exigente de monitoramento, com observadores em sua maioria estudantes, diante de um vídeo. Ele não mostra que as pessoas perdem tudo fora da tarefa, e não foi um estudo de interface. Os autores mencionam um que foi: Haines (1989), em que alguns pilotos, usando um head-up display num simulador de pouso, não notaram um avião bloqueando o caminho.

### Atenção: cegueira à mudança

A cegueira à mudança tem outro desenho. Na técnica de flicker de Rensink, O'Regan e Clark (resumo de 1996), uma imagem original e uma modificada se alternavam por 240 ms cada, com um campo em branco de 80 ms entre elas. As imagens eram cenas reais, e um objeto ou região mudava de aparência, cor ou posição. Os observadores apertavam uma tecla ao ver a mudança. Os tempos de reação em algumas cenas chegaram a 20 segundos, embora as mudanças fossem grandes, repetidas e esperadas. Dicas verbais ajudaram bastante, o que sugeriu que a visibilidade não era o problema. Os autores concluíram que a atenção precisa estar dirigida a um item enquanto ele muda para que a mudança seja percebida.

O contraste importa. Na cegueira por desatenção, o observador não espera nada. Na cegueira à mudança, o observador daqui estava procurando uma mudança e ainda assim levou muitos segundos. Nos dois casos, ter a informação diante dos olhos não bastou. A NN/g (2018) argumenta que carregar uma nova página pode fazer o papel do campo em branco. Isso é analogia, não resultado de laboratório.

### Memória de trabalho: o que Miller mediu

O artigo de Miller, de 1956, discutiu dois limites separados, como explica o relato da Wikipedia sobre o artigo. Um é o julgamento absoluto: nomear estímulos que variam numa dimensão, como tons de alturas diferentes. O desempenho é quase perfeito até cinco ou seis estímulos, o que corresponde a uma capacidade de canal de cerca de 2 a 3 bits. O outro é o span de memória: a lista mais longa que a pessoa consegue repetir em ordem. O resumo de Cowan, em 2010, é que Miller mostrou que se repete uma lista de no máximo cerca de sete itens ou chunks, significativos e em ordem aleatória.

O span é mais ou menos o mesmo para dígitos binários (1 bit cada), dígitos decimais (3,32 bits cada) e palavras (cerca de 10 bits cada), então o limite não está em bits. Miller o descreveu em chunks: a maior unidade significativa que a pessoa reconhece, o que depende do que ela já sabe. Ele tratou a coincidência numérica entre os dois limites como coincidência mesmo. "Sete" também não se manteve como constante depois: o span fica em torno de sete para dígitos, seis para letras e cinco para palavras.

### Memória de trabalho: o que Cowan defende

Cowan (2001), como ele próprio resume em 2010, pergunta o que sobra quando as pessoas não podem usar estratégias. Com ensaio e agrupamento restringidos, a evocação mostra um limite de 3 a 5 itens separados. Os procedimentos incluem um arranjo espacial breve e simultâneo, um canal auditivo não atendido, repetir uma palavra em voz alta durante a apresentação e o running span, em que a lista termina sem aviso. Num estudo que ele relata, jovens adultos que aprenderam novos pares de palavras lembraram cerca de 3 unidades com o ensaio impedido, fossem palavras soltas ou pares aprendidos.

Sete e quatro respondem, portanto, a perguntas diferentes. Cerca de sete é o que as pessoas alcançam repetindo uma lista quando podem usar suas estratégias, e cerca de quatro é uma estimativa de um armazenamento central com essas estratégias bloqueadas. Quatro também não é questão fechada: outras teorias rejeitam qualquer número fixo.

### Por que nenhum dos números dimensiona um menu

Os dois resultados vêm da evocação de material que já não está à vista. Itens de menu continuam na tela. Quem percorre um menu está reconhecendo e buscando, não mantendo a lista na cabeça, então esses experimentos não se aplicam à pergunta. Nem Miller nem Cowan dizem que um menu deve ter sete itens, ou quatro. O número de itens importa por meio de busca e decisão, assunto de `fitts-law-and-hicks-law` e `navigation-menus-windows-and-information-architecture`.

Os achados se aplicam, sim, quando uma informação precisa ser levada de um lugar a outro sem cópia visível.

### Reconhecimento, evocação e memória externa

Reconhecer é mais fácil que evocar porque oferece mais pistas para a recuperação (Budiu, NN/g, 2024). Mostrar opções, itens recentes e valores anteriores transforma uma tarefa de evocação em uma de reconhecimento. O artigo da NN/g sobre memória de trabalho acrescenta a outra metade: quando a tarefa é difícil demais, a interface pode servir de memória externa, guardando o que a pessoa teria de segurar. Então a pergunta de design raramente é "quantos itens?". É "o que esta pessoa precisa carregar na cabeça entre dois momentos, e o sistema pode carregar por ela?".

### Agrupamento Gestalt: descrições, não leis da natureza

O artigo de Wertheimer, de 1923, mostrou que pontos igualmente espaçados formam uma linha uniforme e que mudar o espaçamento faz os pontos mais próximos se agruparem em pares. Wagemans e colegas (2012) chamam a proximidade de primeira de suas "famous laws or (more accurately) principles of grouping", isto é, leis famosas ou, mais precisamente, princípios de agrupamento. Outros incluem similaridade, destino comum, boa continuação, fechamento, simetria e paralelismo. Acréscimos mais novos incluem região comum e conexão entre elementos.

A redação dessa revisão é reveladora. Similaridade, destino comum e fechamento são todos apresentados com "all else being equal" (tudo o mais constante). Um princípio diz para que lado um fator empurra, mas não diz com que força, e em layouts reais o resto não é constante. Críticos antigos censuraram a psicologia da Gestalt por leis imprecisas e por acrescentar uma nova "lei" a cada fator encontrado. Leis quantitativas existem, mas para arranjos experimentais específicos, como reticulados de pontos. Um resultado costuma ser mal aplicado: Elder e Goldberg (2002) acharam a proximidade como a pista de longe mais forte, reduzindo a entropia em cerca de 75%, contra cerca de 10% cada para boa continuação e similaridade. Isso vale para agrupamento de contornos em imagens naturais e não é um ranking para dashboards.

### Feedback e tempo

A orientação de Nielsen, de 1993, dá três limites: 0,1 segundo para a resposta parecer instantânea, 1 segundo para o fluxo de pensamento seguir sem interrupção e 10 segundos para manter a atenção no diálogo. Ele credita esse conselho a Miller 1968 e Card et al. 1991. Este é Robert B. Miller, não o George Miller do número mágico. Os valores são regras práticas para escolher feedback, não limiares medidos.

## Exemplos Resolvidos

### Exemplo 1: mesmas opções, faladas ou mostradas

Tome uma lista de oito opções. Na tela, a lista continua visível. A pessoa percorre até algo servir, e os limites de memória acima não são a restrição. Lidas por um sistema telefônico, as mesmas oito opções somem à medida que são faladas. Quem liga precisa segurar as opções anteriores enquanto julga as seguintes, o que se parece muito mais com a situação de evocação. O mesmo conteúdo tem exigências diferentes. Isso é raciocínio a partir dos estudos, não resultado medido, e não dá um máximo exato.

### Exemplo 2: chunks dependem de quem lê

Um fluxo de suporte mostra um código fictício de 14 caracteres numa tela e o pede na seguinte: `BR202611047731`.

```text
Leitor                         Unidades a segurar
Não vê padrão                  14 caracteres
Vê BR, um ano, uma data        BR | 2026 | 1104 | 7 | 7 | 3 | 1  =  7 unidades
```

Mostrar como `BR-2026-1104-7731` ajuda a achar o padrão, mas hifens não transformam `7731` em chunk, porque chunk é algo que a pessoa já conhece. A correção melhor evita a tarefa de memória: levar o valor para a tela seguinte ou oferecer um botão de copiar. Se a pessoa precisa passar para outro aparelho, o valor deve ser enviado, não lembrado.

### Exemplo 3: espaçamento como evidência de agrupamento

Num formulário fictício, cada rótulo fica 4 px acima do seu campo, e o rótulo seguinte fica 4 px abaixo desse campo.

```text
distância rótulo ao próprio campo:   4 px
distância campo ao rótulo seguinte:  4 px     razão 1:1    ambíguo
depois da correção:                  4 px / 24 px    razão 1:6
```

Com distâncias iguais, a proximidade não diz a qual campo o rótulo pertence. Aumentar a distância externa faz os pares se agruparem. Não existe razão estabelecida aqui: 1:6 é uma escolha para este formulário. Outras pistas também podem se sobrepor. Coloque dois campos num mesmo card com borda e a região comum os une independentemente da distância, o que é útil se for intencional e enganoso se não for.

### Exemplo 4: para onde foi a mensagem de erro?

Uma pessoa preenche um formulário longo, rola até o fim e aperta Enviar. A página recarrega e um resumo vermelho aparece no topo, fora da área visível. Esta é uma inferência a partir dos estudos acima, não um resultado medido neste formulário. A recarga age como o intervalo em branco, e a mensagem surge longe da atenção da pessoa, que pode concluir que nada aconteceu.

Opções melhores colocam o erro ao lado do campo com problema e movem a visão e o foco do teclado para lá. O conselho tem limite: movimento só atrai a atenção se não estiver competindo. Um dashboard de monitoramento com muitos blocos animados ao mesmo tempo traz o problema de volta, porque nenhuma mudança se destaca.

## Equívocos Comuns e Armadilhas

- **"Miller provou que menus precisam de 7 mais ou menos 2 itens."** Ele discutiu julgamento absoluto e span de memória. Menus visíveis não são nenhum dos dois.
- **"Cowan corrigiu sete para quatro, então use quatro."** O resultado trata de armazenamento com estratégias bloqueadas e não dimensiona nenhum componente.
- **"Metade das pessoas não vê o gorila."** O número geral foi de 46% sem relatar o evento, em condições nas quais a taxa de notar foi de 8% a 100%.
- **"Agrupar de três em três torna qualquer coisa memorável."** O espaçamento ajuda a achar as partes. Um chunk exige conhecimento prévio.
- **"As leis da Gestalt ditam o layout."** São tendências enunciadas com "tudo o mais constante", e podem entrar em conflito.
- **"Usuários sentem atrasos acima de 0,1 segundo, está provado."** É orientação, e o Miller citado nela é outro Miller.

## Resumo

As pessoas veem aquilo a que prestam atenção. No estudo de Simons e Chabris, 46% de 192 observadores não relataram um evento inesperado enquanto contavam passes, e os estudos de flicker mostram que é possível procurar por segundos uma mudança grande e repetida. Limites de memória são reais, mas específicos: cerca de sete para span imediato com estratégias disponíveis e de 3 a 5 chunks para um armazenamento central com estratégias bloqueadas, e nenhum se aplica a uma lista que continua na tela. Interfaces ajudam ao transformar evocação em reconhecimento e ao agir como memória externa. Princípios da Gestalt descrevem como o agrupamento tende a acontecer, tudo o mais constante. Para cada um desses achados, confira se a sua situação se parece com a que foi medida.

## Documentation Links

- [Simons and Chabris (1999): Gorillas in our midst](https://www.chabris.com/Simons1999.pdf): desenho, condições e resultados do estudo de cegueira por desatenção, no site de um dos autores.
- [Rensink, O'Regan, and Clark (1996): To See or Not to See, abstract](https://www2.psych.ubc.ca/~rensink/publications/abs.96.2.html): o método de flicker e seus resultados, no site do primeiro autor.
- [Budiu (2018): Change Blindness in UX](https://www.nngroup.com/articles/change-blindness-definition/): definição e relação entre carregamento de página e o flicker de laboratório.
- [Cowan (2010): The Magical Mystery Four](https://pmc.ncbi.nlm.nih.gov/articles/PMC2864034/): o limite de 3 a 5 chunks, suas condições e um resumo do resultado de Miller.
- [Wikipedia: The Magical Number Seven, Plus or Minus Two](https://en.wikipedia.org/wiki/The_Magical_Number_Seven,_Plus_or_Minus_Two): relato dos dois limites de Miller e de trabalhos posteriores sobre span.
- [Budiu (2024): Memory Recognition and Recall in User Interfaces](https://www.nngroup.com/articles/recognition-and-recall/): por que reconhecer é mais fácil que evocar.
- [Budiu (2018): Working Memory and External Memory](https://www.nngroup.com/articles/working-memory-external-memory/): passar carga de memória para a interface.
- [Wagemans et al. (2012): A Century of Gestalt Psychology in Visual Perception, part I](https://pmc.ncbi.nlm.nih.gov/articles/PMC3482144/): princípios de agrupamento, seus limites e tentativas de quantificá-los.
- [Nielsen (1993): Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/): a orientação de 0,1, 1 e 10 segundos e suas fontes.
